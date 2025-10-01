(function() {
    var headers = JSON.parse(sessionStorage.getItem('dlns_headers') || '[]'),
        rows = JSON.parse(sessionStorage.getItem('dlns_rows') || '[]'),
        csv = sessionStorage.getItem('dlns_csv') || '',
        tsv = sessionStorage.getItem('dlns_tsv') || '',
        tsvNoMatchId = sessionStorage.getItem('dlns_tsv_no_match_id') || '',
        isBatch = sessionStorage.getItem('dlns_is_batch') === 'true',
        wrap = document.getElementById('dlnsTableWrap'),
        copyTsvBtn = document.getElementById('dlnsCopyTsvBtn'),
        copyTsvNoMatchIdBtn = document.getElementById('dlnsCopyTsvNoMatchIdBtn'),
        copyCsvBtn = document.getElementById('dlnsCopyCsvBtn'),
        downloadCsvBtn = document.getElementById('dlnsDownloadCsvBtn');

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;')
    }

    function render() {
        if (!rows || !rows.length) {
            if (wrap) {
                wrap.style.display = 'none';
                wrap.innerHTML = ''
            }
            if (copyTsvBtn) copyTsvBtn.disabled = !0;
            if (copyTsvNoMatchIdBtn) {
                copyTsvNoMatchIdBtn.disabled = !0;
                copyTsvNoMatchIdBtn.style.display = 'none'
            }
            if (copyCsvBtn) copyCsvBtn.disabled = !0;
            if (downloadCsvBtn) downloadCsvBtn.disabled = !0;
            return
        }
        var titleEl = document.querySelector('.dlns-title');
        if (titleEl) {
            if (isBatch) {
                var uniqueMatches = new Set;
                rows.forEach(function(r) {
                    if (r.Match_ID) uniqueMatches.add(r.Match_ID)
                });
                titleEl.textContent = 'Batch Results (' + uniqueMatches.size + ' matches, ' + rows.length + ' players)'
            } else titleEl.textContent = 'Match Results (' + rows.length + ' players)'
        }
        for (var html = '<table class="dlns-table"><thead class="dlns-thead"><tr>' + headers.map(function(h) {
                return '<th class="dlns-th">' + escapeHtml(h) + '</th>'
            }).join('') + '</tr></thead><tbody>', i = 0; i < rows.length; i++) {
            var r = rows[i];
            html += '<tr class="dlns-tr">' + headers.map(function(h) {
                var v = r[h] === undefined || r[h] === null ? '' : r[h];
                return '<td class="dlns-td">' + escapeHtml(v) + '</td>'
            }).join('') + '</tr>'
        }
        html += '</tbody></table>';
        if (wrap) {
            wrap.innerHTML = html;
            wrap.style.display = 'block'
        }
        var has = !!csv;
        if (copyTsvBtn) copyTsvBtn.disabled = !has;
        if (copyCsvBtn) copyCsvBtn.disabled = !has;
        if (downloadCsvBtn) downloadCsvBtn.disabled = !has;
        if (copyTsvNoMatchIdBtn) {
            if (isBatch && tsvNoMatchId) {
                copyTsvNoMatchIdBtn.style.display = '';
                copyTsvNoMatchIdBtn.disabled = !1
            } else {
                copyTsvNoMatchIdBtn.style.display = 'none';
                copyTsvNoMatchIdBtn.disabled = !0
            }
        }
    }

    function copy(text) {
        return navigator.clipboard.writeText(text)
    }
    if (copyTsvBtn) copyTsvBtn.addEventListener('click', function() {
        copy(tsv)
    });
    if (copyTsvNoMatchIdBtn) copyTsvNoMatchIdBtn.addEventListener('click', function() {
        copy(tsvNoMatchId)
    });
    if (copyCsvBtn) copyCsvBtn.addEventListener('click', function() {
        copy(csv)
    });
    if (downloadCsvBtn) downloadCsvBtn.addEventListener('click', function() {
        var blob = new Blob([csv], {
                type: 'text/csv;charset=utf-8;'
            }),
            url = URL.createObjectURL(blob),
            a = document.createElement('a'),
            filename = isBatch ? 'batch_matches_export.csv' : 'match_export.csv';
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(function() {
            URL.revokeObjectURL(url)
        }, 1e3)
    });
    render()
})();