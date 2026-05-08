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

    function l(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms)
        })
    }

    async function p(jobId, onLine) {
        var since = 0,
            result = null;
        for (;;) {
            var res = await fetch("/dlns/process/status/" + encodeURIComponent(jobId) + "?since=" + since, {
                cache: "no-store"
            });
            if (!res.ok) throw new Error("Status check failed: " + res.status + " " + (res.statusText || ""));
            var body = await res.json(),
                logs = body.logs || [];
            logs.forEach(function(entry) {
                var msg = entry && entry.message ? String(entry.message) : "";
                if (!msg) return;
                if (entry.type === "error") onLine("ERROR: " + msg);
                else onLine(msg)
            }), since = Number(body.next_since || since);
            if (body.done) {
                if (body.status === "completed") {
                    result = body.result || null;
                    break
                }
                throw new Error(body.error || "Processing failed")
            }
            await l(900)
        }
        return result
    }

    async function i() {
        var o = document.getElementById("dlnsMatchId"),
            c = o ? String(o.value || "").trim() : "",
            detailsEl = document.getElementById("dlnsIncludeDetails"),
            includeDetailed = !!(detailsEl && detailsEl.checked);
        if (!c) {
            alert("Please enter a match ID or comma-separated match IDs");
            return
        }
        a();
        var d = c.includes(",");
        s(d ? "Batch processing mode detected..." : "Single match processing..."), s(includeDetailed ? "Detailed breakdown enabled." : "Detailed breakdown disabled."), s("Submitting job..."), r(!0);
        try {
            localStorage.setItem("dlns_include_detailed", includeDetailed ? "true" : "false")
        } catch (e) {}
        try {
            var startRes = await fetch("/dlns/process/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    match_id: c,
                    include_detailed: includeDetailed
                })
            });
            if (!startRes.ok) {
                var errPayload = await startRes.json().catch(function() {
                    return {}
                });
                throw new Error(errPayload.error || ("Start request failed: " + startRes.status + " " + (startRes.statusText || "")))
            }

            var start = await startRes.json(),
                jobId = start.job_id,
                h = null;
            if (!jobId) throw new Error("Missing job id from server");
            s("Job started: " + jobId.slice(0, 8));

            h = await p(jobId, s);

            h && h.rows ? ("batch_result" === h.type ? (s("Batch processing complete!"), s("Total matches: " + h.total_matches), s("Total players: " + h.total_players)) : s("Single match processing complete!"), sessionStorage.setItem("dlns_rows", JSON.stringify(h.rows)), sessionStorage.setItem("dlns_headers", JSON.stringify(h.headers)), sessionStorage.setItem("dlns_csv", h.csv), sessionStorage.setItem("dlns_tsv", h.tsv), sessionStorage.setItem("dlns_is_batch", "batch_result" === h.type ? "true" : "false"), sessionStorage.setItem("dlns_hero_details", JSON.stringify(h.hero_details || [])), sessionStorage.setItem("dlns_match_id", String(h.match_id || c)), h.tsv_no_match_id ? sessionStorage.setItem("dlns_tsv_no_match_id", h.tsv_no_match_id) : sessionStorage.removeItem("dlns_tsv_no_match_id"), n && (n.style.display = ""), s('Results ready. Click "View Results" to see the data.')) : s("No results received.")
        } catch (e) {
            s("Error: " + (e && (e.message || e.toString()) || String(e)))
        } finally {
            r(!1)
        }
    }
    try {
        var detailsPref = localStorage.getItem("dlns_include_detailed"),
            detailsElInit = document.getElementById("dlnsIncludeDetails");
        detailsElInit && (detailsElInit.checked = "true" === detailsPref)
    } catch (e) {}
    e && e.addEventListener("click", i)
})();