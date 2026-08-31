## ADDED Requirements

### Requirement: Signed Updater & Reproducible Release
All release assets for v0.1.82 MUST be signed with valid signatures and reproducible from the tagged git checkout.

#### Scenario: Signed latest.json and .sig verification
- **Given** release artifacts generated for version 0.1.82
- **When** updater assets `latest.json` and artifact `.sig` files are verified
- **Then** the digital signature validates against the public updater key

#### Scenario: Tagged checkout reproduces release assets
- **Given** git tag `v0.1.82`
- **When** checking out the tagged commit in a clean workspace
- **Then** all build configurations, migration files, and assets compile into identical release bundles
