# ArchAI - Free

### Mnogorolevaya arhitektura II-agenta · Executor · Expert · Critic

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Visibility](https://img.shields.io/badge/visibility-public-brightgreen)](https://github.com/satyasai-collab/archai-free)
[![Roles](https://img.shields.io/badge/roles-3-blue)](docs)
[![Stack](https://img.shields.io/badge/stack-TS%20%7C%20Python%20%7C%20YAML-informational)](.)

> Otkrytaya realizaciya zhestkogo mnogoagentnogo protokola: ispolnitel ne prinimaet
> arhitekturnyh resheniy sam - kazhdyy shag i kazhdaya mutaciya prohodyat verifikaciyu
> sudey (Expert) i avtomaticheskim kritikom (Critic).

---

## Vozmozhnosti

- **Trehrolevaya schema** - `Executor` (osnovnaya model), `Expert` (sudya s chistym
  kontekstom i nulem instrumentov), `Critic` (zhestkiy QA, read-only).
- **HARD STOP mutaciy** - lyubaya mutaciya bez verdikta Critic blokiruetsya protokolom.
- **Monitor dreyfa** - `opencode/plugin/expert_monitor.ts` so schetchikami shagov i
  TTL-razblokirovkoy.
- **Gotovye konfigi** dlya [opencode](opencode/) i [Hermes](hermes/).
- **DoD-verifikaciya** - yavnoe opredelenie gotovnosti dlya kazhdogo shaga.

## Arhitektura

![Architecture](assets/architecture.svg)

Potok: `Executor` poluchaet zadachu ot `User`, vyzivaet `Expert` dlya dekompozicii i
verifikacii, vypolnyaet shagi, zatem `Critic` zhestko proveryaet rezultat do otveta
polzovatelyu. Lyubaya mutaciya sistemy trebuet verdikta `Expert` i `Critic`.

## Kak eto rabotaet

1. **Dekompoziciya** - `Expert` razbivaet zadachu na atomarnye shagi s kriteriyami uspeha.
2. **Ispolnenie** - `Executor` vypolnyaet shag cherez instrumenty.
3. **Verifikaciya shaga** - `Expert` podtverzhdaet korrektnost i otsutstvie regressa.
4. **Final + Critic** - `Expert` finalnaya proverka, zatem `Critic` (QA) po 4 frontam.

## Struktura repozitoriya

```
archai-free/
+-- docs/                     # Protokoly i audit
|   +-- EXPERT_PROTOCOL.md
|   +-- HERMES_MULTI_ROLE_PROTOCOL.md
|   +-- AUDIT_2026-08-23.md
+-- opencode/                 # Konfigi opencode
|   +-- agent/{critic,expert}.md
|   +-- plugin/{expert_monitor.ts,expert_statusbar.tsx,memory.ts,statusbar.tsx}
|   +-- opencode.json.example
+-- hermes/                   # Konfigi Hermes
|   +-- config.example.yaml
|   +-- SOUL.md
|   +-- plugins/{critic_hy3,role_monitor}/
+-- assets/
|   +-- architecture.svg
+-- LICENSE
+-- README.md
```

## Bystryy start

```bash
# opencode-konfigi
cp -r opencode/ ~/.config/opencode/

# Hermes-konfigi
cp -r hermes/ ~/.hermes/
```

Podrobnee - v [docs/EXPERT_PROTOCOL.md](docs/EXPERT_PROTOCOL.md) i
[docs/HERMES_MULTI_ROLE_PROTOCOL.md](docs/HERMES_MULTI_ROLE_PROTOCOL.md).

## Licenziya

[MIT](LICENSE) - svobodnoe ispolzovanie, rasprostranenie i modifikaciya.
