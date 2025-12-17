# TAT Protocol JSON Schemas

This directory contains JSON Schema definitions for all TAT Protocol data structures. These schemas enable:

- **Validation**: Verify messages conform to protocol
- **Code Generation**: Generate types for different languages
- **Documentation**: Machine-readable protocol specification
- **Interoperability**: Standard validation across implementations

## Schema Files

### Core Protocol

- [token-header.schema.json](./token-header.schema.json) - JWT header for tokens
- [token-payload.schema.json](./token-payload.schema.json) - JWT payload for tokens
- [nwpc-request.schema.json](./nwpc-request.schema.json) - NWPC request messages
- [nwpc-response.schema.json](./nwpc-response.schema.json) - NWPC response messages

### NWPC Methods

- [methods/mint-request.schema.json](./methods/mint-request.schema.json) - Mint method parameters
- [methods/transfer-request.schema.json](./methods/transfer-request.schema.json) - Transfer method parameters
- [methods/verify-request.schema.json](./methods/verify-request.schema.json) - Verify method parameters

## Usage

### Validation (Node.js)

```javascript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import tokenHeaderSchema from './token-header.schema.json';

const ajv = new Ajv();
addFormats(ajv);

const validate = ajv.compile(tokenHeaderSchema);

const header = {
  alg: 'Schnorr',
  typ: 'FUNGIBLE',
  token_hash: 'a1b2c3d4...',
  ver: '1.0.0'
};

if (validate(header)) {
  console.log('Valid!');
} else {
  console.error(validate.errors);
}
```

### Validation (Python)

```python
import jsonschema
import json

with open('token-header.schema.json') as f:
    schema = json.load(f)

header = {
    'alg': 'Schnorr',
    'typ': 'FUNGIBLE',
    'token_hash': 'a1b2c3d4...',
    'ver': '1.0.0'
}

try:
    jsonschema.validate(header, schema)
    print('Valid!')
except jsonschema.ValidationError as e:
    print(f'Invalid: {e.message}')
```

### Type Generation (TypeScript)

```bash
# Install json-schema-to-typescript
npm install -g json-schema-to-typescript

# Generate types
json2ts -i schemas/*.schema.json -o types/
```

### Type Generation (Go)

```bash
# Install go-jsonschema
go install github.com/atombender/go-jsonschema@latest

# Generate types
go-jsonschema -p protocol schemas/*.schema.json > protocol/types.go
```

## Validation Tools

### Command-Line Validation

```bash
# Install ajv-cli
npm install -g ajv-cli

# Validate data against schema
ajv validate -s token-header.schema.json -d data.json
```

### Online Validators

- [JSON Schema Validator](https://www.jsonschemavalidator.net/)
- [Ajv JSON schema validator](https://ajv.js.org/)

## Schema Versioning

Schemas are versioned alongside the protocol:

- **Major Version**: Breaking schema changes (incompatible)
- **Minor Version**: Backward-compatible additions (new optional fields)
- **Patch Version**: Documentation or clarification only

Current Schema Version: **1.0.0**

## Contributing

When adding new protocol features:

1. Update or create JSON schema
2. Add validation tests
3. Regenerate types if needed
4. Update this README
5. Add examples

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## References

- [JSON Schema Specification](https://json-schema.org/)
- [Understanding JSON Schema](https://json-schema.org/understanding-json-schema/)
- [TAT Protocol Specification](../PROTOCOL_SPEC.md)
- [Interoperability Guide](../INTEROPERABILITY.md)

## License

CC0 (Public Domain) - Same as TAT Protocol specification
