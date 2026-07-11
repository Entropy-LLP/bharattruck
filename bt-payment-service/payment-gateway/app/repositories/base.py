# app/repositories/base.py
# This file implements the generic BaseRepository for DRY (Don't Repeat Yourself) CRUD database access.
# Uses modern SQLAlchemy 2.0 query patterns (like select and scalars) and Pydantic validation mapping.

from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import Base

# Declare Type Variables for generic subclass resolution
ModelType = TypeVar("ModelType", bound=Base)
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class BaseRepository(Generic[ModelType, CreateSchemaType, UpdateSchemaType]):
    """
    Base Repository class containing default CRUD operations.
    Standardizes database querying and maps fields via Pydantic.
    """

    def __init__(self, model: type[ModelType]) -> None:
        self.model = model

    def get(self, db: Session, id: Any) -> ModelType | None:
        """
        Fetch a single database record by primary key.
        """
        return db.get(self.model, id)

    def get_multi(
        self, db: Session, *, skip: int = 0, limit: int = 100
    ) -> list[ModelType]:
        """
        Fetch a page of records matching the offset and limit.
        """
        query = select(self.model).offset(skip).limit(limit)
        return list(db.scalars(query).all())

    def create(self, db: Session, *, obj_in: CreateSchemaType) -> ModelType:
        """
        Create and persist a new database record.
        """
        # Convert schema fields to dictionary data
        obj_in_data = obj_in.model_dump()
        db_obj = self.model(**obj_in_data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def update(
        self,
        db: Session,
        *,
        db_obj: ModelType,
        obj_in: UpdateSchemaType | dict[str, Any]
    ) -> ModelType:
        """
        Update fields on an existing database record.
        """
        if isinstance(obj_in, dict):
            update_data = obj_in
        else:
            update_data = obj_in.model_dump(exclude_unset=True)

        for field in update_data:
            if hasattr(db_obj, field):
                setattr(db_obj, field, update_data[field])

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def remove(self, db: Session, *, id: Any) -> ModelType | None:
        """
        Delete a database record by primary key.
        """
        obj = db.get(self.model, id)
        if obj:
            db.delete(obj)
            db.commit()
        return obj
