#!/bin/sh
# Explicit variable list required — envsubst without it would replace nginx's own $host, $remote_addr, etc.
set -e

envsubst '${DNS_RESOLVER} ${AUTH_SERVICE_URL} ${BOOKING_SERVICE_URL} ${PRICING_SERVICE_URL} ${PAYMENT_SERVICE_URL} ${CARGO_SERVICE_URL} ${CORS_ALLOWED_ORIGINS}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
