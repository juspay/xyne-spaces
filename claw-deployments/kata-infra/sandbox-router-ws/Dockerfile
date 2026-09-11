FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sandbox_router.py .

# Run as an unprivileged user. Port 8080 is >1024 so no capability is needed to bind it.
RUN useradd --system --uid 10001 --create-home appuser
USER appuser

EXPOSE 8080
CMD ["uvicorn", "sandbox_router:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
