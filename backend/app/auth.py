import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, status, Response
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import get_db
from . import models

# If you run behind HTTPS (Cloud Run custom domain), keep this True in production.
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "true").lower() == "true"

# Parent domain to share cookie across movies.* and api.movies.*
# Set explicitly in prod: COOKIE_DOMAIN=".qayyumayaan.dev"
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN")  # e.g. ".qayyumayaan.dev" or leave unset for localhost

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev_secret_key_change_me")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def set_auth_cookie(response: Response, token: str) -> None:
    """
    Cross-subdomain cookie for frontend on movies.qayyumayaan.dev calling API on api.movies.qayyumayaan.dev.
    Requires:
      - SameSite=None
      - Secure=True (browser requirement for SameSite=None)
      - Domain=.qayyumayaan.dev to share across subdomains
    """
    max_age = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=max_age,
        expires=max_age,
        samesite="none",              # IMPORTANT for cross-origin fetch w/ credentials
        secure=SECURE_COOKIES,        # must be True in production
        path="/",
        domain=COOKIE_DOMAIN,         # set to ".qayyumayaan.dev" in production; omit in localhost
    )


def clear_auth_cookie(response: Response) -> None:
    """
    Must match domain/path/secure/samesite closely to reliably clear in browsers.
    """
    response.delete_cookie(
        key="access_token",
        path="/",
        domain=COOKIE_DOMAIN,
        secure=SECURE_COOKIES,
        samesite="none",
    )


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> models.User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise JWTError()
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user
