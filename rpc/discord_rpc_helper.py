#!/usr/bin/env python3
import sys
import json
import time
from pypresence import Presence, ActivityType
from pypresence.exceptions import InvalidID, InvalidPipe


class RPCHelper:
    def __init__(self, client_id: str):
        self.client_id = client_id
        self.rpc = None
        self.connected = False
        self._last_update = 0
        self._UPDATE_INTERVAL = 15

    def connect(self):
        if self.connected:
            return True
        try:
            if self.rpc:
                try:
                    self.rpc.close()
                except Exception:
                    pass
            self.rpc = Presence(self.client_id)
            self.rpc.connect()
            self.connected = True
            print("[RPC Helper] Connected", flush=True)
            return True
        except InvalidID:
            print(f"[RPC Helper] Invalid Client ID", flush=True)
            self.connected = False
            return False
        except (InvalidPipe, ConnectionError, OSError) as e:
            print(f"[RPC Helper] Discord not running: {e}", flush=True)
            self.connected = False
            return False
        except Exception as e:
            print(f"[RPC Helper] Connect error: {e}", flush=True)
            self.connected = False
            return False

    def update(self, **kwargs):
        if not self.connected:
            if not self.connect():
                return

        if 'activity_type' in kwargs:
            at = kwargs['activity_type']
            if isinstance(at, int):
                kwargs['activity_type'] = ActivityType(at)

        try:
            self.rpc.update(**kwargs)
            print(f"[RPC Helper] Updated", flush=True)
        except (InvalidPipe, ConnectionError, OSError) as e:
            print(f"[RPC Helper] Pipe error: {e}", flush=True)
            self.connected = False
        except Exception as e:
            print(f"[RPC Helper] Update error: {e}", flush=True)
            self.connected = False

    def clear(self):
        if not self.connected or not self.rpc:
            return
        try:
            self.rpc.clear()
            self._last_update = 0
            print("[RPC Helper] Cleared", flush=True)
        except (InvalidPipe, ConnectionError, OSError) as e:
            print(f"[RPC Helper] Clear pipe error: {e}", flush=True)
            self.connected = False
        except Exception as e:
            print(f"[RPC Helper] Clear error: {e}", flush=True)
            self.connected = False

    def disconnect(self):
        if self.rpc:
            try:
                self.rpc.close()
            except Exception:
                pass
        self.connected = False
        print("[RPC Helper] Disconnected", flush=True)


def main():
    if len(sys.argv) < 2:
        print("[RPC Helper] No client ID provided", flush=True)
        sys.exit(1)

    client_id = sys.argv[1]
    helper = RPCHelper(client_id)

    time.sleep(0.5)
    helper.connect()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            cmd = msg.get("cmd")
            data = msg.get("data", {})

            if cmd == "update":
                helper.update(**data)
            elif cmd == "clear":
                helper.clear()
            elif cmd == "disconnect":
                helper.disconnect()
                break
        except json.JSONDecodeError:
            print(f"[RPC Helper] Invalid JSON: {line}", flush=True)
        except Exception as e:
            print(f"[RPC Helper] Error: {e}", flush=True)

    sys.exit(0)


if __name__ == "__main__":
    main()