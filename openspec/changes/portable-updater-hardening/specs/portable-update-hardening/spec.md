## ADDED Requirements

### Requirement: Layout determines updates after discovery
The application SHALL await the native storage layout for each check and installation and SHALL reject unresolved layout instead of selecting the installed target.

#### Scenario: Portable discovery is delayed
- **WHEN** the updater mounts before native paths resolve
- **THEN** no MSI/NSIS check is issued and the eventual portable check selects windows-x86_64-portable

### Requirement: Portable replacement is signed and recoverable
Windows portable updates SHALL verify the configured signature before staging, replace the same executable only after its process exits, preserve data, and restore the old executable if replacement or relaunch fails.

#### Scenario: Successful portable update
- **WHEN** a newer signed ZIP contains the supported executable and marker
- **THEN** the production helper updates and relaunches that executable in the original folder while .echo-ai remains unchanged

#### Scenario: Unsafe payload or failed replacement
- **WHEN** signature verification, archive validation, filesystem replacement or relaunch fails
- **THEN** the original executable and user data remain available and failure is reported without claiming success

### Requirement: Existing installed update behavior remains supported
Installed copies SHALL retain MSI/NSIS download/install/relaunch through the stock updater and both existing controls SHALL expose portable progress/errors without duplicate restarts.

#### Scenario: Installed copy updates
- **WHEN** native layout is appdata
- **THEN** the updater follows its normal installer path

### Requirement: Release publication includes complete portable artifacts
The workflow SHALL sign using supported CLI flags, validate and upload the ZIP/signature and portable target before publishing the release as latest.

#### Scenario: Portable release step fails
- **WHEN** archive/signature/upload/manifest validation fails
- **THEN** the new partial release is not promoted as latest
