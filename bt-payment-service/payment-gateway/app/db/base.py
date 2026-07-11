# app/db/base.py
# This file serves as the database base metadata registry.
# It defines the declarative Base class using the modern SQLAlchemy 2.0 syntax.
# All ORM models in the application must inherit from this Base.
# Import this file inside Alembic's 'env.py' to enable autogenerate functionality.

from sqlalchemy.orm import DeclarativeBase, declared_attr


class Base(DeclarativeBase):
    """
    Common Base model for all SQLAlchemy tables.
    Provides automatic table name generation based on lowercased class name,
    minimizing boilerplate.
    """

    @declared_attr.directive
    def __tablename__(cls) -> str:
        # Convert class name CamelCase to snake_case table name
        import re

        name = cls.__name__
        pattern = re.compile(r"(?<!^)(?=[A-Z])")
        return pattern.sub("_", name).lower()


# Models registration moved to migrations entrypoint (alembic/env.py) or imported dynamically where needed.
