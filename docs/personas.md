# Personas and Design Council

Note: These personas and design council members are design artifacts documented in the project's CLAUDE.md context. They are not defined in source code files. They represent the intended users and advisory perspectives that informed WaterVoice DMV's design decisions.

---

## User Personas

The following 5 personas represent the primary intended users of WaterVoice DMV. They reflect the diversity of people who recreate near water in the DC Metro area.

### Diego
A recreational kayaker who paddles regularly on Four Mile Run and the lower Potomac. Diego wants a quick answer before loading his car — is today's water safe enough for the paddle? He is comfortable with mobile apps and checks conditions on his phone at the put-in. The "PASS / CAUTION / UNSAFE" status badge was designed primarily for Diego's use case.

### Tanisha
A mother of two who takes her family to wade and splash at water access points during summer. She is more cautious than Diego and prioritizes "unsafe for children" clarity. The activity-specific advisories (swimming, wading) were designed with Tanisha in mind, as swimming safety for children is a higher bar than kayaking.

### Brett
An avid fly fisherman who fishes from shore along the Anacostia and Potomac. Brett does not immerse himself in the water but is aware of bacteria from handling fish and touching the bank. The fishing-specific advisory ("lowest-contact option — wash hands before handling food") addresses Brett's exposure pattern.

### Linda
A retiree who walks along the Four Mile Run trail and occasionally wades in shallow sections. Linda is not a regular app user and may encounter WaterVoice DMV through a trail-side QR code or a friend's recommendation. The plain-language disclaimers ("Advisory only. Not a regulatory determination.") and the first-use disclaimer modal ("Before you paddle") are designed to be accessible to Linda without prior water quality knowledge.

### Kwame
A youth sports coach who runs paddling programs out of the Bladensburg Waterfront. Kwame needs to make go/no-go decisions for groups of young people. He uses the app's historical readings chart and geometric mean to understand whether elevated readings are a one-time spike or a persistent trend.

---

## Design Council

The following six personas represent advisory perspectives that shaped WaterVoice DMV's design. They are named as shorthand for specific viewpoints, not real individuals.

### Priya
Represents the public health perspective. Priya's voice is behind the "fail-safe" design rule: when two indicators are present (E. coli and Enterococci), always surface the more conservative classification. Her perspective drove the legal disclaimer requirement on every surface that displays water quality data.

### Marcus
Represents the paddling community and regular power users. Marcus pushed for the activity-specific advisories (swimming vs. kayaking vs. wading vs. fishing) rather than a one-size-fits-all status, because risk is genuinely different for each activity.

### Amara
Represents environmental justice and multilingual accessibility. Amara's influence is reflected in the 6th grade reading level requirement for all AI-generated explanations and the plain-language status labels.

### Kenji
Represents the technical/developer perspective. Kenji is behind the adapter architecture, the testability requirements (injectable `fetchImpl`), and the 90% unit test coverage threshold.

### Sofia
Represents the legal/disclaimer perspective (also referred to as "Rachel's legal disclaimer" in CLAUDE.md). Sofia ensured that every site card, AI explanation, and email includes the appropriate advisory-only language and that the app never claims regulatory authority.

### Rachel
Named directly in the CLAUDE.md for the site card disclaimer ("Rachel's legal disclaimer on every site card"). Represents the risk-management perspective that advisory language must be visible at every point of decision, not just in a terms-of-service page.
