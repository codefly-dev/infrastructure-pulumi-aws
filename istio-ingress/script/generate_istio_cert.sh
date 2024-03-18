# Generate a private key
openssl genrsa -out istio.key 2048

# Generate a Certificate Signing Request (CSR)
openssl req -new -key istio.key -out istio.csr -subj "/CN=*.codefly.build"

# Generate a self-signed certificate from the CSR
openssl x509 -req -days 365 -in istio.csr -signkey istio.key -out istio.crt