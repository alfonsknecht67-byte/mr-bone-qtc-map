import sqlite3, sys
with sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True) as conn:
    print(conn.execute("SELECT COALESCE(MAX(block_height),0) FROM chain_index").fetchone()[0])
