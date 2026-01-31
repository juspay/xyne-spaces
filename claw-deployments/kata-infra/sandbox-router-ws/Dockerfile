FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sandbox_router.py .

EXPOSE 8080
CMD ["uvicorn", "sandbox_router:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
