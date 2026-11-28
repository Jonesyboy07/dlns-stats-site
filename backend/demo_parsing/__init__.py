"""Demo parsing: per-second stats, assists, damage and timed events from replay files.

`ingest.run_demo_parse` is the entry point (`backend/main.py -demoparse`). The parser
itself (boon) is optional and only imported by `worker.py`, inside its own process --
nothing here needs boon to be installed in the web server's environment.
"""
