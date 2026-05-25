"""
Logging Middleware
──────────────────
Runs on every request:
  1. Generates a short request_id (8-char UUID) and stores in ContextVar
  2. Logs to access.log: method, path, status, duration
  3. On unhandled exception: logs to error.log with traceback
  4. Adds X-Request-ID response header so frontend/client can trace requests
"""

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging_config import access_logger, app_logger, request_id_var


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Short 8-char request ID — readable in logs, unique enough per session
        req_id = str(uuid.uuid4())[:8]
        token = request_id_var.set(req_id)
        start = time.perf_counter()

        try:
            response = await call_next(request)
            duration_ms = int((time.perf_counter() - start) * 1000)

            access_logger.info(
                f"{request.method} {request.url.path} → {response.status_code} ({duration_ms}ms)"
            )

            # Attach request ID to response so it shows in browser network tab
            response.headers["X-Request-ID"] = req_id
            return response

        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            app_logger.error(
                f"Unhandled exception on {request.method} {request.url.path} ({duration_ms}ms): {exc}",
                exc_info=True,
            )
            raise

        finally:
            request_id_var.reset(token)
