(function() {
    var e = document.getElementById("dlnsRunBtn"),
        t = document.getElementById("dlnsProgress"),
        n = document.getElementById("dlnsViewBtn");

    function r(n) {
        e && (e.disabled = n)
    }

    function s(e) {
        t && (t.textContent += (t.textContent ? "\n" : "") + e, t.scrollTop = t.scrollHeight)
    }

    function a() {
        t && (t.textContent = "")
    }
    async function i() {
        var o = document.getElementById("dlnsMatchId"),
            c = o ? String(o.value || "").trim() : "";
        if (!c) {
            alert("Please enter a match ID or comma-separated match IDs");
            return
        }
        a();
        var d = c.includes(",");
        s(d ? "Batch processing mode detected..." : "Single match processing..."), s("Submitting job..."), r(!0);
        try {
            var l = await fetch("/dlns/process", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    match_id: c
                })
            });
            if (!l.ok) throw new Error("Request failed: " + l.status + " " + (l.statusText || ""));
            var p = l.body.getReader(),
                f = new TextDecoder,
                g = "",
                h = null;
            for (;;) {
                var m = await p.read();
                if (m.done) break;
                g += f.decode(m.value, {
                    stream: !0
                });
                var u = g.split("\n");
                g = u.pop(), u.forEach(function(e) {
                    if (e = e.trim()) {
                        try {
                            var t = JSON.parse(e);
                            switch (t.type) {
                                case "log":
                                case "progress":
                                    s(t.message);
                                    break;
                                case "batch_start":
                                    s(t.message);
                                    break;
                                case "result":
                                case "batch_result":
                                    h = t, "batch_result" === t.type ? (s("Batch processing complete!"), s("Total matches: " + t.total_matches), s("Total players: " + t.total_players)) : s("Single match processing complete!");
                                    break;
                                case "error":
                                    s("ERROR: " + t.message)
                            }
                        } catch (t) {
                            console.error("Failed to parse event:", e, t)
                        }
                    }
                })
            }
            if (g.trim()) try {
                var y = JSON.parse(g.trim());
                ("result" === y.type || "batch_result" === y.type) && (h = y)
            } catch (e) {}
            h && h.rows ? (sessionStorage.setItem("dlns_rows", JSON.stringify(h.rows)), sessionStorage.setItem("dlns_headers", JSON.stringify(h.headers)), sessionStorage.setItem("dlns_csv", h.csv), sessionStorage.setItem("dlns_tsv", h.tsv), sessionStorage.setItem("dlns_is_batch", "batch_result" === h.type ? "true" : "false"), h.tsv_no_match_id && sessionStorage.setItem("dlns_tsv_no_match_id", h.tsv_no_match_id), n && (n.style.display = ""), s('Results ready. Click "View Results" to see the data.')) : s("No results received.")
        } catch (e) {
            s("Error: " + (e && (e.message || e.toString()) || String(e)))
        } finally {
            r(!1)
        }
    }
    e && e.addEventListener("click", i)
})();