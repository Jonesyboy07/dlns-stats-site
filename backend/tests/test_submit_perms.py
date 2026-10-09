from backend.app.utils.auth import has_submit_perms, get_match_submitter_ids


def test_submit_perms(monkeypatch):
    monkeypatch.setenv('DISCORD_OWNER_ID', '1')
    monkeypatch.setenv('DISCORD_CO_OWNER_ID', '2')
    monkeypatch.setenv('DISCORD_ADMIN_IDS', '')
    monkeypatch.setenv('MATCH_SUBMITTER', '3, 4')
    monkeypatch.delenv('MATCH_SUBMITTERS', raising=False)
    assert get_match_submitter_ids() == ['3', '4']
    for uid in ('1', '2', '3', '4'):
        assert has_submit_perms(uid)
    assert not has_submit_perms('5')
