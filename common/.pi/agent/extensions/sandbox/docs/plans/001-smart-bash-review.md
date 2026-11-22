# Smart bash safety review

## Task 1: suspicious command detection
- Add pure detector for interpreter, wrapper, pipe, redirection, substitution, and mutation indicators.
- Add failing tests first.

## Task 2: response contract
- Replace steering response with decision/ confidence/ explanation.
- Validate strict JSON and fail soft.
- Add failing tests first.

## Task 3: integration and handover
- Preserve deterministic checks first.
- Review suspicious whitelisted commands only.
- Block confident unsafe results with exact command, intent, safety reason, and manual user handover.
- Add failing tests first.

## Task 4: verification
- Run full test suite.
- Ensure files <=300 lines and exported functions documented.
- Commit conventional change.