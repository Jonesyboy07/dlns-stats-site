import hashlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask
import requests

from backend.cdn import create_cdn_app
from backend.app.blueprints.cdn_admin import cdn_admin_bp
from backend.app.cdn_site_assets import stylesheet_url
from scripts import sync_cdn_assets


class CdnTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'test.css').write_bytes(b'body { color: red }')
        self.client = create_cdn_app(self.root).test_client()

    def tearDown(self):
        self.tmp.cleanup()

    def test_manifest_versioning_and_revalidation(self):
        digest = hashlib.sha256(b'body { color: red }').hexdigest()
        manifest = self.client.get('/__cdn/manifest?path=test.css')
        self.assertEqual(manifest.json, {'files': {'test.css': digest[:8]}})
        self.assertIn('no-store', manifest.headers['Cache-Control'])
        response = self.client.get('/test.css?v=' + digest[:8])
        self.assertEqual(response.data, b'body { color: red }')
        self.assertIn('immutable', response.headers['Cache-Control'])
        self.assertEqual(response.content_type, 'text/css; charset=utf-8')
        conditional = self.client.get('/test.css', headers={'If-None-Match': response.headers['ETag']})
        self.assertEqual(conditional.status_code, 304)
        conditional.close()
        response.close()
        legacy = self.client.get('/test.css?v=' + digest)
        self.assertEqual(legacy.status_code, 200)
        self.assertIn('immutable', legacy.headers['Cache-Control'])
        legacy.close()
        legacy = self.client.get('/test.css?v=' + digest[:16])
        self.assertEqual(legacy.status_code, 200)
        legacy.close()
        self.assertEqual(self.client.get('/test.css?v=' + digest[:15]).status_code, 404)
        unversioned = self.client.get('/test.css')
        self.assertIn('no-cache', unversioned.headers['Cache-Control'])
        unversioned.close()
        (self.root / 'test.css').write_bytes(b'changed')
        for version in (digest, digest[:16], digest[:8]):
            stale = self.client.get('/test.css?v=' + version)
            self.assertEqual(stale.status_code, 404)
            self.assertIn('no-store', stale.headers['Cache-Control'])
        self.assertNotEqual(self.client.get('/__cdn/manifest?path=test.css').json['files']['test.css'], digest[:8])

    def test_existing_long_hash_filenames_still_work(self):
        data = b'legacy css'
        digest = hashlib.sha256(data).hexdigest()
        folder = self.root / '__site_assets' / 'css'
        folder.mkdir(parents=True)
        for version in (digest[:16], digest):
            path = folder / f'styles.{version}.css'
            path.write_bytes(data)
            response = self.client.get('/__site_assets/css/' + path.name)
            self.assertEqual(response.status_code, 200)
            self.assertIn('immutable', response.headers['Cache-Control'])
            response.close()

    def test_ranges_head_and_protected_paths(self):
        response = self.client.get('/test.css', headers={'Range': 'bytes=0-3'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b'body')
        response.close()
        head = self.client.head('/test.css')
        self.assertEqual(head.headers['Content-Length'], '19')
        head.close()
        for name in ('.env', 'secret.key', 'x.sqlite3'):
            (self.root / name).write_bytes(b'secret')
            self.assertEqual(self.client.get('/' + name).status_code, 404)
        self.assertEqual(self.client.get('/../test.css').status_code, 404)
        self.assertEqual(self.client.get('/test.css?v=incorrect').status_code, 404)
        self.assertEqual(self.client.get('/__cdn/manifest').status_code, 400)

    def test_symlink_is_not_served(self):
        target = self.root / 'link.css'
        try:
            target.symlink_to(self.root / 'test.css')
        except OSError:
            self.skipTest('Creating symlinks requires elevated permissions')
        self.assertEqual(self.client.get('/link.css').status_code, 404)


class CdnAdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'CDN_ROOT': self.tmp.name, 'DISCORD_OWNER_ID': '1',
                                           'DISCORD_CO_OWNER_ID': '2', 'CDN_PUBLIC_BASE_URL': 'https://cdn.example'})
        self.env.start()
        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(cdn_admin_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def post(self, name='test.css', content=b'abc', replace='false', origin='http://localhost'):
        return self.client.post('/admin/cdn/upload', data={'file': (io.BytesIO(content), name),
                                'folder': 'images', 'replace': replace},
                                headers={'Accept': 'application/json', 'Origin': origin})

    @patch('backend.app.utils.auth.get_current_user', return_value={'id': '3', 'username': 'admin'})
    def test_non_owner_is_denied(self, _user):
        self.assertEqual(self.post().status_code, 403)

    @patch('backend.app.utils.auth.get_current_user', return_value=None)
    def test_anonymous_is_denied(self, _user):
        self.assertEqual(self.post().status_code, 401)

    @patch('backend.app.utils.auth.get_current_user', return_value={'id': '1', 'username': 'owner'})
    def test_sandbox_cannot_upload(self, _user):
        with patch.dict(os.environ, {'DLNS_SANDBOX': '1'}):
            self.assertEqual(self.post().status_code, 403)

    @patch('backend.app.blueprints.cdn_admin.get_current_user', return_value={'id': '2', 'username': 'owner'})
    @patch('backend.app.utils.auth.get_current_user', return_value={'id': '2', 'username': 'owner'})
    def test_upload_and_explicit_replacement(self, _auth, _user):
        self.assertEqual(self.post(origin='https://evil.example').status_code, 403)
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['hash'], hashlib.sha256(b'abc').hexdigest()[:8])
        self.assertTrue(response.json['url'].endswith('?v=' + response.json['hash']))
        cdn = create_cdn_app(Path(self.tmp.name)).test_client()
        served = cdn.get('/images/test.css?v=' + response.json['hash'])
        self.assertEqual(served.status_code, 200)
        self.assertIn('immutable', served.headers['Cache-Control'])
        served.close()
        self.assertEqual(self.post(content=b'new').status_code, 409)
        self.assertEqual(self.post(content=b'new', replace='true').status_code, 200)
        self.assertEqual((Path(self.tmp.name) / 'images' / 'test.css').read_bytes(), b'new')
        self.assertEqual(self.post(name='secret.key').status_code, 400)
        self.assertEqual(self.post(name='../escape').status_code, 400)
        with patch.dict(os.environ, {'CDN_UPLOAD_MAX_BYTES': '2'}):
            self.assertEqual(self.post(name='large.css', content=b'abc').status_code, 413)

    @patch('backend.app.utils.auth.get_current_user', return_value={'id': '1', 'username': 'owner'})
    def test_reserved_and_traversal_folders_are_denied(self, _user):
        for folder in ('__site_assets', '__cdn', '../outside', '.hidden'):
            response = self.client.post(
                '/admin/cdn/upload',
                data={'file': (io.BytesIO(b'abc'), 'x.txt'), 'folder': folder},
                headers={'Accept': 'application/json', 'Origin': 'http://localhost'},
            )
            self.assertEqual(response.status_code, 400)

    @patch('backend.app.blueprints.cdn_admin.get_current_user', return_value={'id': '1', 'username': 'owner'})
    @patch('backend.app.utils.auth.get_current_user', return_value={'id': '1', 'username': 'owner'})
    def test_upload_rejects_collision_with_current_file(self, _auth, _user):
        self.assertEqual(self.post(content=b'first').status_code, 200)
        with patch('backend.app.blueprints.cdn_admin.short_hash', return_value='a' * 8):
            response = self.post(content=b'second', replace='true')
        self.assertEqual(response.status_code, 409)
        self.assertIn('collision', response.json['error'])
        self.assertEqual((Path(self.tmp.name) / 'images' / 'test.css').read_bytes(), b'first')


class CdnSiteTests(unittest.TestCase):
    def test_sync_mirrors_public_files_and_static_fallback_urls(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            source = Path(source)
            cdn_only_icons = Path(target) / 'static'
            cdn_only_icons.mkdir(parents=True)
            icon_names = (
                'android-chrome-192x192.png',
                'android-chrome-512x512.png',
                'apple-touch-icon.png',
                'favicon-16x16.png',
                'favicon-32x32.png',
                'favicon.ico',
                'site.webmanifest',
            )
            for name in icon_names:
                (cdn_only_icons / name).write_bytes(('cdn:' + name).encode())
            (source / 'public' / 'react-app').mkdir(parents=True)
            (source / 'public' / 'css').mkdir()
            (source / 'static' / 'css').mkdir(parents=True)
            (source / 'public' / 'react-app' / 'module.js').write_text('export default 1;')
            (source / 'public' / 'css' / 'shared.css').write_text('public version')
            (source / 'static' / 'css' / 'shared.css').write_text('static version')
            (source / 'static' / 'css' / 'fallback.css').write_text('fallback version')
            (source / 'static' / 'favicon.ico').write_bytes(b'favicon')
            (source / 'static' / 'apple-touch-icon.png').write_bytes(b'apple icon')

            with patch.object(sync_cdn_assets, 'PROJECT', source), \
                    patch.dict(os.environ, {'CDN_ROOT': target}):
                sync_cdn_assets.sync()

            client = create_cdn_app(Path(target)).test_client()
            self.assertEqual(client.get('/public/react-app/module.js').data, b'export default 1;')
            self.assertEqual(client.get('/static/react-app/module.js').data, b'export default 1;')
            self.assertEqual(client.get('/static/css/shared.css').data, b'public version')
            self.assertEqual(client.get('/static/css/fallback.css').data, b'fallback version')
            for name in icon_names:
                self.assertEqual(client.get('/static/' + name).data, ('cdn:' + name).encode())

    def test_sync_and_manifest_url(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            source = Path(source)
            (source / 'public' / 'css').mkdir(parents=True)
            (source / 'public' / 'fonts').mkdir()
            (source / 'public' / 'images').mkdir()
            css = source / 'public' / 'css' / 'styles.css'
            css.write_text('a { src: url("../fonts/example.woff2"); }')
            (source / 'public' / 'fonts' / 'example.woff2').write_bytes(b'font')
            (source / 'public' / 'images' / 'example.png').write_bytes(b'image')
            legacy = Path(target) / '__site_assets' / 'css' / 'styles.css'
            legacy.parent.mkdir(parents=True)
            legacy.write_bytes(b'old')
            untouched = Path(target) / 'legacy.png'
            untouched.write_bytes(b'legacy')
            with patch.object(sync_cdn_assets, 'PROJECT', source), patch.dict(os.environ, {'CDN_ROOT': target}):
                sync_cdn_assets.sync()
            app = create_cdn_app(Path(target))
            client = app.test_client()
            manifest = client.get('/__cdn/site-assets')
            self.assertIn('no-store', manifest.headers['Cache-Control'])
            files = manifest.json['files']
            css_name = files['css/styles.css']
            self.assertRegex(css_name, r'^__site_assets/css/styles\.[0-9a-f]{8}\.css$')
            self.assertFalse(legacy.exists())
            self.assertEqual(untouched.read_bytes(), b'legacy')
            response = client.get('/' + css_name)
            self.assertIn('immutable', response.headers['Cache-Control'])
            self.assertIn(files['fonts/example.woff2'].encode(), response.data)
            response.close()
            image = client.get('/' + files['images/example.png'])
            self.assertIn('immutable', image.headers['Cache-Control'])
            image.close()
            font = client.get('/' + files['fonts/example.woff2'])
            self.assertEqual(font.content_type, 'font/woff2')
            font.close()
            self.assertTrue(css_name.endswith('.css'))
            with patch.object(sync_cdn_assets, 'PROJECT', source), patch.dict(os.environ, {'CDN_ROOT': target}):
                css.write_text('body{color:red}')
                sync_cdn_assets.sync()
            updated = client.get('/__cdn/site-assets').json['files']['css/styles.css']
            self.assertNotEqual(css_name, updated)
            old_response = client.get('/' + css_name)
            self.assertEqual(old_response.status_code, 200)
            old_response.close()
            (Path(target) / updated).write_bytes(b'tampered')
            invalid = client.get('/' + updated)
            self.assertEqual(invalid.status_code, 404)
            self.assertIn('no-store', invalid.headers['Cache-Control'])
            site = Flask(__name__)
            with site.test_request_context('/'), \
                    patch.dict(os.environ, {'CDN_PUBLIC_BASE_URL': 'https://cdn.example',
                                            'CDN_MANIFEST_BASE_URL': 'http://localhost:5051'}), \
                    patch('backend.app.cdn_site_assets.requests.get') as get:
                get.return_value.json.return_value = {'version': 1, 'files': {'css/styles.css': updated}}
                self.assertEqual(stylesheet_url('css/styles.css'), 'https://cdn.example/' + updated)

    def test_hash_collision_does_not_replace_published_asset_or_manifest(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
            source = Path(source)
            (source / 'public' / 'css').mkdir(parents=True)
            css = source / 'public' / 'css' / 'styles.css'
            css.write_text('first')
            with patch.object(sync_cdn_assets, 'PROJECT', source), \
                    patch.dict(os.environ, {'CDN_ROOT': target}), \
                    patch.object(sync_cdn_assets, 'short_hash', return_value='a' * 8):
                sync_cdn_assets.sync()
                manifest = (Path(target) / sync_cdn_assets.MANIFEST).read_bytes()
                css.write_text('second')
                sync_cdn_assets.sync()
                self.assertNotEqual((Path(target) / sync_cdn_assets.MANIFEST).read_bytes(), manifest)
                self.assertEqual((Path(target) / '__site_assets' / 'css' / ('styles.' + 'a' * 8 + '.css')).read_text(), 'first')
                digest = hashlib.sha256(b'second').hexdigest()
                self.assertEqual((Path(target) / '__site_assets' / 'css' / f'styles.{digest}.css').read_text(), 'second')

    def test_manifest_failure_falls_back_and_skips_subsequent_requests(self):
        site = Flask(__name__)
        with site.test_request_context('/'), \
                patch.dict(os.environ, {'CDN_PUBLIC_BASE_URL': 'https://cdn.example',
                                        'CDN_MANIFEST_BASE_URL': 'http://localhost:5051'}), \
                patch('backend.app.cdn_site_assets.requests.get', side_effect=requests.ConnectionError()) as get:
            self.assertEqual(stylesheet_url('css/style.css'), '/static/css/style.css')
            self.assertEqual(stylesheet_url('css/components.css'), '/static/css/components.css')
            self.assertEqual(get.call_count, 1)


if __name__ == '__main__':
    unittest.main()
