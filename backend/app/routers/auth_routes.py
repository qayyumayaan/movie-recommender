from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from .. import schemas, models, auth
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.UserOut)
def register_user(
    user_in: schemas.UserCreate,
    response: Response,
    db: Session = Depends(get_db),
):
    existing_username = (
        db.query(models.User).filter(models.User.username == user_in.username).first()
    )
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered")

    existing_email = (
        db.query(models.User).filter(models.User.email == user_in.email).first()
    )
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = models.User(
        username=user_in.username,
        email=user_in.email,
        password_hash=auth.get_password_hash(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = auth.create_access_token({"sub": str(user.id), "username": user.username})
    auth.set_auth_cookie(response, token)

    return user


@router.post("/login", response_model=schemas.UserOut)
def login(
    creds: schemas.UserLogin,
    response: Response,
    db: Session = Depends(get_db),
):
    user = (
        db.query(models.User)
        .filter(
            or_(
                models.User.username == creds.username_or_email,
                models.User.email == creds.username_or_email,
            )
        )
        .first()
    )

    if not user or not auth.verify_password(creds.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    token = auth.create_access_token({"sub": str(user.id), "username": user.username})
    auth.set_auth_cookie(response, token)

    return user


@router.post("/logout")
def logout(response: Response):
    auth.clear_auth_cookie(response)
    return {"detail": "Logged out"}


@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user
