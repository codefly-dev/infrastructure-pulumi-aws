# Generate a private key
openssl genpkey -algorithm RSA -out istio.key

# Generate a Certificate Signing Request (CSR) with the common name
openssl req -new -key istio.key -out istio.csr -subj "/CN=*.codefly.build"

# Create a SAN configuration file
echo "subjectAltName=DNS:*.codefly.build" > san.ext

# Generate a self-signed certificate from the CSR, including the SAN
openssl x509 -req -days 365 -in istio.csr -signkey istio.key -out istio.crt -extfile san.ext