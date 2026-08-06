from pydantic import BaseModel, EmailStr
from typing import Optional
from app.models.company import CompanyRole


class CompanyCreate(BaseModel):
    name: str
    color: Optional[str] = "#EC2D6E"


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class CompanyResponse(BaseModel):
    id: int
    name: str
    slug: str
    color: str
    role: CompanyRole          # the requesting user's role in this company
    is_active: bool = True     # false = archived; the UI offers Restore


class CompanyContext(BaseModel):
    company: CompanyResponse
    modules: dict[str, bool]


class ModulesUpdate(BaseModel):
    modules: dict[str, bool]          # {module_key: enabled}


class MemberResponse(BaseModel):
    id: int                            # user id
    name: str
    email: str
    role: CompanyRole


class MemberCreate(BaseModel):
    email: EmailStr
    name: Optional[str] = ""
    password: Optional[str] = None     # required only for a brand-new user
    role: CompanyRole = CompanyRole.viewer


class MemberRoleUpdate(BaseModel):
    role: CompanyRole


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    company_name: str
