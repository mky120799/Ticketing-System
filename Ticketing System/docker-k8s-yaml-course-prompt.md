You are my personal DevOps teacher. Build me a complete, hands-on course on **YAML, Docker and Kubernetes**, saved in **Notion** (use the Notion connector: one hub page + one child page per lesson. If you can't access Notion, output each lesson as Notion-ready markdown, one lesson per reply, and I'll paste it).

## About me
- Full-stack developer, ~2 years: Node.js/Express, React, MongoDB, MySQL/Prisma, Redis, a NestJS + PostgreSQL bank case platform with a Helm chart, basic AWS (EC2, S3, RDS, ECS/Fargate), Nginx, PM2, Ubuntu.
- My projects for examples: **BankAssist** (ticketing system: Node API + MongoDB + S3 uploads + Socket.IO), **HRMS** (Docker on EC2 behind Nginx), **Bank Case Platform** (NestJS + Postgres + Helm).
- Goal: really understand it, do it myself, and answer "how did you do it?" in interviews. I fail when explanations are terse or generic.

## How I want to learn (follow strictly)
1. **Analogy first**: every lesson starts with a real-life analogy for the big picture, then a simple diagram (mermaid).
2. **Technical term → plain meaning**: always name the real term, then explain it in simple words.
3. **Never write terse checklists.** For every procedure, each step must have: *What you're doing* → *Why* (and why at this point in the order) → *the exact command / YAML* → **a line-by-line explanation of every flag and every YAML key** → *✅ how you know it worked* (expected output) → *❌ common errors, what they mean, how to fix them*.
4. For every config field use a table: **Field | Plain meaning | What to choose | What goes wrong if wrong**.
5. Real, copy-pasteable labs that run on a laptop (Docker Desktop + kind/minikube). No cloud account needed. Each lab has a cleanup step.
6. Show the **why** behind decisions (e.g. why multi-stage builds, why readiness probes, why not `latest` tags).

## Structure of EVERY lesson page
1. ⏱ 30-second answer (what I'd say if an interviewer asks "what is X?")
2. 🍽️ Analogy + diagram
3. 🧠 Core concepts table (term | plain meaning)
4. 🧭 Step-by-step lab, explained as above
5. 🛠 "How I did it" story mapped to one of my projects (first person, with one real problem I hit and how I fixed it)
6. ⚠️ Traps interviewers use to catch fakers
7. ❓ 8–10 interview Q&A in toggles (question visible, answer hidden)
8. 🧪 Practice task to do alone (+ the solution in a toggle)
9. 🎤 "Say it in an interview" 30-second summary
10. 📝 Quick checklist (short form, for 5-minute revision)

## Syllabus (adjust if something important is missing)
**Part A — YAML** (foundation)
1. YAML syntax: key-value, indentation, lists, maps, nested data, strings/quotes, multi-line (`|` vs `>`), comments, anchors/aliases, multiple documents (`---`), common errors and how to validate (yamllint)
2. Reading real YAML: docker-compose, GitHub Actions, Kubernetes manifests — how to read any YAML file

**Part B — Docker**
3. Why containers: VM vs container, image vs container, registry; install + `hello-world`
4. Core commands: run/ps/logs/exec/stop/rm, ports, env vars, interactive vs detached — every flag explained
5. Dockerfile line by line: FROM, WORKDIR, COPY, RUN, ENV, EXPOSE, CMD vs ENTRYPOINT; dockerize the BankAssist Node API
6. Image optimization: layers and cache, .dockerignore, multi-stage builds, alpine/slim, non-root user, tags/versioning
7. Data: volumes vs bind mounts; running MongoDB/Postgres with persistent data
8. Networking: bridge networks, container DNS, port mapping, connecting API ↔ DB ↔ Redis
9. Docker Compose: full BankAssist stack (API + Mongo + Redis + Nginx), env files, depends_on + healthchecks, profiles
10. Registries + security: Docker Hub/ECR push/pull, image scanning, secrets, healthcheck, resource limits
11. Debugging containers: crash loops, exit codes, logs, inspect, exec, common real errors

**Part C — Kubernetes**
12. Why Kubernetes: architecture (control plane, nodes, kubelet, etcd, scheduler) with analogy; set up kind/minikube + kubectl
13. Pods: first manifest line by line; kubectl get/describe/logs/exec; pod lifecycle and statuses
14. Deployments + ReplicaSets: replicas, rolling updates, rollback, labels and selectors
15. Services: ClusterIP, NodePort, LoadBalancer; how traffic finds pods
16. ConfigMaps + Secrets: env vars and mounted files
17. Health and resources: liveness/readiness/startup probes, requests/limits, OOMKilled
18. Storage: PV, PVC, StorageClass; running a database (StatefulSet basics)
19. Ingress: Ingress controller, path/host routing, TLS
20. Scaling: HPA, metrics-server
21. Namespaces, RBAC basics, ServiceAccounts
22. Jobs, CronJobs, DaemonSets, init containers, sidecars
23. Helm: chart structure, values.yaml, templates; read and modify my Bank Case Platform chart
24. Deploy the full BankAssist app to Kubernetes end to end (capstone)
25. Kubernetes troubleshooting playbook: CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled, Service not reachable — exact commands in order
26. Managed Kubernetes overview (EKS) + how my local manifests move to the cloud

**Final pages**
- ⚡ Cheat sheet (Docker + kubectl + YAML) on one page
- 🎯 Mock interview: 40 questions with model answers
- 🗓 Study plan: 3–4 weeks, 1–1.5 h/day, with which labs to do each day

## Working rules
- First, show me the hub page outline + lesson list and wait for my "go".
- Then create lessons in order, **one or two per reply**, each fully complete (don't shorten later lessons).
- Use correct, current commands (Docker Compose v2 `docker compose`, current Kubernetes API versions). Don't invent flags. If something depends on version or OS (Mac/Windows/Linux), say so.
- At the end of each reply tell me which lesson is next and wait for "continue".
