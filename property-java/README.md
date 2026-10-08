# Property CRM: learning Java through your existing app

We will build one feature at a time, explain the code, and include a small exercise.
This directory currently contains lesson 1, not a working Spring Boot clone.

## Destination

React frontend → Spring Boot REST controllers → services → repositories → PostgreSQL.

Use one backend application, organized by feature. The intended tools are Maven
for dependencies/builds, Spring Data JPA for persistence, Spring Security for
authentication and authorization, Flyway for the clone's database migrations,
and JUnit for Java tests. Choose and pin compatible versions when scaffolding.
The clone will use a separate development database and synthetic client data.

| Existing app | Java clone | What you learn |
| --- | --- | --- |
| `lib/property/commission.ts` | Commission calculation service | Types, records, methods, BigDecimal, tests |
| Next.js API route handlers | REST controllers and request/response records | HTTP, validation, dependency injection |
| Supabase database queries | JPA entities and repositories | SQL mapping, transactions, pagination |
| Route guards and Supabase RLS | Spring Security plus ownership checks | Authentication versus authorization |
| React property pages | React frontend calling the Java API | Browser/server boundaries |
| Reminder cron and integrations | Scheduled jobs and integration services | Scheduling, retries, external APIs |

## Feature sequence

1. Commission calculator in plain Java, then a Spring Boot endpoint and React form.
2. Authentication, agent identity, and case create/list/detail/edit with ownership checks.
3. Case lifecycle, admin permissions, and activity history.
4. Earnings dashboard, follow-ups, and reminders.
5. Documents, notifications, profile, and Google Calendar integration.
6. Remaining property features: shared rates/resources, calculators, bank insights,
   subscription gating, and property admin reporting. Inventory behavior before porting.

For each feature: read its existing behavior, explain the Java concepts, implement
a small slice, verify it, and give an exercise before moving on.

Source inspection found outdated status descriptions in `docs/10-property-app.md`.
Current `lib/types/property.ts` lists draft, submitted, paid, rejected, and
opportunity_due. Reconcile these with migrations and route behavior before
implementing the lifecycle. The current commission code separately rounds both
shares; preserve that behavior initially, including potential one-cent differences
between the sum of shares and gross.

## Lesson 1: commission calculation

Read `lessons/01-commission/CommissionCalculator.java` alongside the original
`lib/property/commission.ts`.

- `BigDecimal` represents decimal amounts. Construct it from a string to avoid
  introducing binary floating-point approximations.
- `class` groups the calculator's behavior; `static` lets us call a method without
  creating an instance. Later, Spring will manage an instance of our service.
- `record Commission(...)` is an immutable holder with accessors such as `gross()`.
- `private static final` constants belong to the class and cannot be reassigned.
- `setScale(2, HALF_UP)` rounds positive amounts to cents. Negative loans are rejected.
- `main` is the entry point for this small command-line program.

### Run

A JDK supporting records is required (Java 17 or newer for this lesson).
During initial inspection, neither `java` nor `javac` was available on the terminal
PATH. Install/configure a JDK before running; this lesson has not yet been executed.

From the repository root in PowerShell:

```powershell
java --version
javac --version
java property-java/lessons/01-commission/CommissionCalculator.java 1000000
```

Java's source-file launcher compiles and runs this single file for you.
Expected output:

```text
Loan:  1000000
Gross: 1500.00
Agent: 1350.00
TLC:   150.00
```

### Small exercises

1. Predict the result for a loan of 800000, then run it. Expected gross: 1200.00;
   agent: 1080.00; TLC: 120.00.
2. Run with 0 and then -1. Explain why one produces zero commission and the other
   throws an exception.
3. Explain why the calculator rounds gross before calculating the two shares.

Next lesson: scaffold Spring Boot with Maven, move this calculation into a service,
add JUnit cases (including rounding boundaries), and expose a validated endpoint.
Then build the React form that calls it.

Official reference for the upcoming REST lesson:
https://spring.io/guides/gs/rest-service/
