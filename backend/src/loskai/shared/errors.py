"""The one way a request is refused for a reason Loskai knows.

Each module's error derives from `LoskaiError` and carries its HTTP status, decided where it
is raised ("not found" is a 404 there, and nowhere else). `main.py` turns any of them into
`{"detail"}` with that status, so a router raises and catches nothing to translate.
"""


class LoskaiError(Exception):
    status_code = 400

    def __init__(self, detail: str, status_code: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if status_code is not None:
            self.status_code = status_code


def describe_error(exc: BaseException) -> str:
    """What went wrong, in words — some errors (httpx's ConnectError) stringify empty."""
    return str(exc) or exc.__class__.__name__
