"""Shared strict validation for review metadata URL observations."""

from urllib.parse import urlsplit


def validate_credential_free_https(value, label):
    """Require a canonical absolute HTTPS authority without userinfo."""
    message = f"{label} must be credential-free HTTPS"
    if not isinstance(value, str) or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in value):
        raise ValueError(message)
    try:
        parsed = urlsplit(value)
        port = parsed.port
        hostname = parsed.hostname
    except (TypeError, ValueError) as exc:
        raise ValueError(message) from exc

    authority = parsed.netloc
    if (parsed.scheme != "https" or not authority or not hostname
            or parsed.username is not None or parsed.password is not None
            or "@" in authority or "\\" in authority
            or "%" in authority
            or port is not None and not 1 <= port <= 65535):
        raise ValueError(message)

    canonical_host = f"[{hostname}]" if ":" in hostname else hostname
    canonical_authority = canonical_host if port is None else f"{canonical_host}:{port}"
    if authority.casefold() != canonical_authority.casefold():
        raise ValueError(message)


def access_observation_tuple_error(observation):
    """Return an error when status, final URL, and access wall disagree."""
    if not isinstance(observation, dict):
        raise ValueError("source observation must be an object")
    status = observation.get("status")
    final_url = observation.get("final_url")
    access_wall = observation.get("access_wall")
    if final_url is None:
        if status is None and access_wall == "bot_or_network_block":
            return None
        return ("final URL may be null only for an authoritative network failure "
                "with null status and bot_or_network_block access wall")
    if status is None:
        return "network failure final URL must be null"
    return None


def validate_review_metadata_observation(source_url, observation, *, review_status=None,
                                         label="source"):
    """Validate one review metadata observation at any pipeline ingress."""
    validate_credential_free_https(source_url, f"{label} URL")
    tuple_error = access_observation_tuple_error(observation)
    if tuple_error:
        raise ValueError(f"{label} tuple is inconsistent: {tuple_error}")
    final_url = observation.get("final_url")
    if final_url is None:
        if review_status == "approved":
            raise ValueError("approved review requires every source-check final URL")
        return
    validate_credential_free_https(final_url, f"{label} final URL")
