from pydantic import BaseModel, EmailStr
from typing import Optional
from app.models.company import CompanyRole


class CompanyCreate(BaseModel):
    name: str
    color: Optional[str] = "#EC2D6E"


class CompanyResponse(BaseModel):
    id: int
    name: str
    slug: str
    color: str
    role: CompanyRole          # the requesting user's role in this company


class CompanyContext(BaseModel):
    company: CompanyResponse
    modules: dict[str, bool]


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    company_name: str
