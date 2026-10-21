from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import Configuration, Database, OptionalUser
from app.ml.model_service import ModelService, ModelUnavailableError, get_model_service
from app.schemas.auth import MessageResponse
from app.schemas.join import JoinAgentRead, JoinRegistrationInput
from app.services.geoip import CountryLookup, get_country_lookup
from app.services.registration import active_agent_profile, register_customer

router = APIRouter(prefix="/join", tags=["Public registration"])
type Models = Annotated[ModelService, Depends(get_model_service)]
type Lookup = Annotated[CountryLookup, Depends(get_country_lookup)]


@router.get("/{code}", response_model=JoinAgentRead)
def read_join_link(code: str, session: Database) -> JoinAgentRead:
    """Public: the agent's display name only."""
    return JoinAgentRead(display_name=active_agent_profile(session, code).display_name)


@router.post("/{code}/register", response_model=MessageResponse, status_code=201)
def register(
    code: str,
    payload: JoinRegistrationInput,
    request: Request,
    session: Database,
    settings: Configuration,
    model_service: Models,
    lookup: Lookup,
    signed_in: OptionalUser,
) -> MessageResponse:
    """Public: register a customer. The response never contains the score."""
    try:
        register_customer(
            session,
            request,
            settings,
            model_service,
            lookup,
            code,
            payload,
            signed_in,
        )
    except ModelUnavailableError:
        session.rollback()
        raise HTTPException(
            503, "Registration is temporarily unavailable. Please try again later."
        ) from None
    return MessageResponse(message="Registration received")
