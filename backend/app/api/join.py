from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import Configuration, Database, OptionalUser
from app.ml.model_service import ModelService, ModelUnavailableError, get_model_service
from app.schemas.join import (
    JoinAgentRead,
    JoinRegistrationInput,
    RegistrationReceived,
)
from app.services.geoip import CountryLookup, get_country_lookup
from app.services.registration import active_join_link, register_customer

router = APIRouter(prefix="/join", tags=["Public registration"])
type Models = Annotated[ModelService, Depends(get_model_service)]
type Lookup = Annotated[CountryLookup, Depends(get_country_lookup)]


@router.get("/{code}", response_model=JoinAgentRead)
def read_join_link(code: str, session: Database) -> JoinAgentRead:
    """Public: the agent's display name and the client's organisation name only."""
    link = active_join_link(session, code)
    return JoinAgentRead(
        display_name=link.profile.display_name, client_name=link.organisation_name
    )


@router.post("/{code}/register", response_model=RegistrationReceived, status_code=201)
def register(
    code: str,
    payload: JoinRegistrationInput,
    request: Request,
    session: Database,
    settings: Configuration,
    model_service: Models,
    lookup: Lookup,
    signed_in: OptionalUser,
) -> RegistrationReceived:
    """Public: register a customer. The response never contains the score.

    The reference lets the customer quote their registration; it reveals
    nothing about the score or the review.
    """
    try:
        customer = register_customer(
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
    return RegistrationReceived(
        message="Registration received", reference=customer.reference
    )
