# ------------------------------------------------------------------------------
# Stage 1: Compilar Frontend React (Vite + Tailwind)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend

COPY sp-extractor-wails/frontend/package*.json ./
RUN npm ci

COPY sp-extractor-wails/frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Compilar Backend Go (Servidor Web REST)
# ------------------------------------------------------------------------------
FROM golang:1.24-alpine AS backend-builder
WORKDIR /build/backend

COPY sp-extractor-wails/go.mod sp-extractor-wails/go.sum ./
RUN go mod download

COPY sp-extractor-wails/ ./

# Reemplazar el dist embebido con el generado por Vite
COPY --from=frontend-builder /build/frontend/dist ./cmd/web/dist

# Compilar binario 100% estático
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /spextractor-web ./cmd/web

# ------------------------------------------------------------------------------
# Stage 3: Imagen final ligera (Alpine Linux)
# ------------------------------------------------------------------------------
FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=backend-builder /spextractor-web /app/spextractor-web

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/spextractor-web"]
