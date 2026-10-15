FROM ubuntu:24.04 AS lean-core
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl zstd git libgmp10 && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 https://github.com/leanprover/lean4/releases/download/v4.35.0/lean-4.35.0-linux_aarch64.tar.zst -o /tmp/lean.tar.zst && echo 'c8f0f8a3920e839718b1343e6781fd80a3e9b1024fbcd7078eb30f54e806b028  /tmp/lean.tar.zst' | sha256sum -c - && mkdir -p /opt/lean && tar --zstd -xf /tmp/lean.tar.zst --strip-components=1 -C /opt/lean && rm /tmp/lean.tar.zst
ENV PATH="/opt/lean/bin:${PATH}"
WORKDIR /proof
CMD ["lean", "--version"]
FROM lean-core AS lean-mathlib
RUN git clone --depth 1 --branch v4.35.0 https://github.com/leanprover-community/mathlib4.git /opt/mathlib && test "$(git -C /opt/mathlib rev-parse HEAD)" = '56a005855ea17e0b0958f73ec801ae140b0a1679'
WORKDIR /opt/mathlib
RUN lake exe cache get
RUN lake env lean --version && lake env printenv LEAN_PATH > /opt/mathlib-lean-path
RUN chmod -R a+rX /opt/mathlib
CMD ["lake", "env", "lean", "--version"]
