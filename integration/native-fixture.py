"""Local-only MCP fixture for the native Pi integration test; no external I/O."""
import json
import os
import sys
import threading
import time
from pathlib import Path

lock = threading.Lock()
log = Path(os.environ["AUDIT_LOG"])
echo_enabled = True

def record(event, **fields):
    with lock:
        with log.open("a") as f:
            f.write(json.dumps({"pid": os.getpid(), "event": event, **fields}) + "\n")

def send(message):
    with lock:
        print(json.dumps(message), flush=True)

def tool(name, properties=None, required=None, **fields):
    return {"name": name, "description": name + " audit fixture", "inputSchema": {
        "type": "object", "properties": properties or {}, "required": required or []}, **fields}

def tools():
    result = [tool("fail"), tool("remove_echo"), tool("restore_echo"), tool("slow")]
    if echo_enabled:
        result.append(tool("echo", {"value": {"type": "string"}}, ["value"],
            outputSchema={"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]},
            annotations={"readOnlyHint": True, "destructiveHint": False}))
    return result

def respond(req):
    global echo_enabled
    method = req["method"]
    if method == "initialize":
        result = {"protocolVersion": req["params"]["protocolVersion"], "capabilities": {"tools": {"listChanged": True}},
                  "serverInfo": {"name": "native-audit", "version": "1.0"}}
    elif method == "ping": result = {}
    elif method == "tools/list": result = {"tools": tools()}
    elif method == "tools/call":
        name = req["params"]["name"]
        record("call", name=name, arguments=req["params"].get("arguments"))
        if name == "echo":
            result = {"content": [{"type": "text", "text": "text view"}],
                      "structuredContent": {"value": req["params"]["arguments"]["value"]}, "_meta": {"secret": "app-only"}}
        elif name == "fail": result = {"content": [{"type": "text", "text": "intentional failure"}], "isError": True}
        else:
            if name == "slow": time.sleep(0.5)
            else:
                echo_enabled = name == "restore_echo"
                send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
            result = {"content": [{"type": "text", "text": "ok"}]}
    else:
        send({"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "unsupported"}})
        return
    send({"jsonrpc": "2.0", "id": req["id"], "result": result})

record("start")
for line in sys.stdin:
    req = json.loads(line)
    record(req["method"])
    if "id" in req:
        threading.Thread(target=respond, args=(req,), daemon=True).start()
record("eof")
