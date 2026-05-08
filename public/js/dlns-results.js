(function() {
    var headers = JSON.parse(sessionStorage.getItem('dlns_headers') || '[]'),
        rows = JSON.parse(sessionStorage.getItem('dlns_rows') || '[]'),
        heroDetails = JSON.parse(sessionStorage.getItem('dlns_hero_details') || '[]'),
        matchId = sessionStorage.getItem('dlns_match_id') || '',
        csv = sessionStorage.getItem('dlns_csv') || '',
        tsv = sessionStorage.getItem('dlns_tsv') || '',
        tsvNoMatchId = sessionStorage.getItem('dlns_tsv_no_match_id') || '',
        isBatch = sessionStorage.getItem('dlns_is_batch') === 'true',
        wrap = document.getElementById('dlnsTableWrap'),
        detailSection = document.getElementById('dlnsHeroBreakdownSection'),
        detailWrap = document.getElementById('dlnsHeroBreakdownWrap'),
        copyTsvBtn = document.getElementById('dlnsCopyTsvBtn'),
        copyTsvNoMatchIdBtn = document.getElementById('dlnsCopyTsvNoMatchIdBtn'),
        copyCsvBtn = document.getElementById('dlnsCopyCsvBtn'),
        downloadCsvBtn = document.getElementById('dlnsDownloadCsvBtn');

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;')
    }

    function formatInt(n) {
        var v = Number(n || 0);
        if (!isFinite(v)) return '0';
        return Math.round(v).toLocaleString();
    }

    function formatPercent(n) {
        if (n === null || n === undefined || n === '') return 'N/A';
        var v = Number(n);
        if (!isFinite(v)) return 'N/A';
        return v.toFixed(1) + '%';
    }

    function renderTimeline(events) {
        if (!events || !events.length) return '<span class="dlns-muted">No item transactions</span>';
        var lines = events.map(function(ev) {
            var cls = ev.type === 'SELL' ? 'dlns-chip-sell' : 'dlns-chip-buy';
            return '<span class="dlns-chip ' + cls + '">' +
                escapeHtml((ev.time || '?') + ' ' + (ev.type || 'EVENT')) +
                '</span> ' +
                '<span>' + escapeHtml(ev.item || 'Unknown Item') + '</span>';
        }).join('<br>');

        var buys = events.filter(function(ev) {
            return ev && ev.type === 'BUY'
        }).length;
        var sells = events.filter(function(ev) {
            return ev && ev.type === 'SELL'
        }).length;

        return '<details class="dlns-timeline">' +
            '<summary>' + escapeHtml(events.length + ' events') +
            ' <span class="dlns-muted">(' + escapeHtml(String(buys)) + ' buy / ' + escapeHtml(String(sells)) + ' sell)</span></summary>' +
            '<div class="dlns-timeline-list">' + lines + '</div>' +
            '</details>';
    }

    function renderHeroBreakdown() {
        if (!detailSection || !detailWrap) return;
        if (isBatch) {
            detailSection.style.display = 'none';
            detailWrap.style.display = 'none';
            detailWrap.innerHTML = '';
            return;
        }

        if (!heroDetails || !heroDetails.length) {
            detailSection.style.display = 'block';
            detailWrap.style.display = 'block';
            detailWrap.innerHTML = '<div class="dlns-note" style="padding:10px;">Detailed breakdown payload is empty for this run. Re-run with the detailed toggle enabled and ensure latest JS is loaded.</div>';
            return;
        }

        var html = '';
        html += '<table class="dlns-table dlns-detail-table"><thead class="dlns-thead"><tr>' +
            '<th class="dlns-th">Player</th>' +
            '<th class="dlns-th">Hero</th>' +
            '<th class="dlns-th">Team</th>' +
            '<th class="dlns-th">Result</th>' +
            '<th class="dlns-th">K/D/A</th>' +
            '<th class="dlns-th">LH/D</th>' +
            '<th class="dlns-th">Shots</th>' +
            '<th class="dlns-th">Damage Taken</th>' +
            '<th class="dlns-th">Self/Team Heal</th>' +
            '<th class="dlns-th">Item Buy/Sell Timeline</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < heroDetails.length; i++) {
            var d = heroDetails[i] || {};
            var shots = formatInt(d['Shots Hit']) + '/' + formatInt(d['Shots Missed']) + ' (' + formatPercent(d['Shot Accuracy %']) + ')';
            var lhD = formatInt(d['Last Hits']) + '/' + formatInt(d['Denies']);
            var heals = formatInt(d['Self Healing']) + '/' + formatInt(d['Teammate Healing']);

            html += '<tr class="dlns-tr dlns-detail-row">' +
                '<td class="dlns-td"><strong>' + escapeHtml(d['Player Name'] || 'Unknown') + '</strong></td>' +
                '<td class="dlns-td">' + escapeHtml(d.Hero || 'Unknown') + '</td>' +
                '<td class="dlns-td">' + escapeHtml(d.Team || 'Unknown') + '</td>' +
                '<td class="dlns-td">' + escapeHtml(d.Result || 'Unknown') + '</td>' +
                '<td class="dlns-td dlns-mono">' + escapeHtml(d.KDA || '0/0/0') + '</td>' +
                '<td class="dlns-td dlns-mono">' + escapeHtml(lhD) + '</td>' +
                '<td class="dlns-td dlns-mono">' + escapeHtml(shots) + '</td>' +
                '<td class="dlns-td dlns-mono">' + escapeHtml(formatInt(d['Damage Taken'])) + '</td>' +
                '<td class="dlns-td dlns-mono">' + escapeHtml(heals) + '</td>' +
                '<td class="dlns-td dlns-items">' + renderTimeline(d['Item Events']) + '</td>' +
                '</tr>';
        }

        html += '</tbody></table>';
        detailWrap.innerHTML = html;
        detailWrap.style.display = 'block';
        detailSection.style.display = 'block';

        var subtitle = document.querySelector('.dlns-subtitle');
        if (subtitle && matchId) subtitle.textContent = 'Detailed Breakdown By Hero (Match ' + matchId + ')';
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

        renderHeroBreakdown();
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