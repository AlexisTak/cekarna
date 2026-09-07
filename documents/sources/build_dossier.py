"""Assemble les PDF archivés générés dans le dossier Cekarna."""

from pathlib import Path

from pypdf import PdfReader, PdfWriter


BASE = Path(__file__).resolve().parent
GENERATED = BASE.parent / "generated"
DESTINATION = BASE.parent / "dossier_cekarna_v2.pdf"
FILES = (
    "cahier_des_charges_cekarna.pdf",
    "optimisation_cekarna_v1.pdf",
    "plan_b2b_saas_v1.pdf",
    "plan_formation_ia_v1.pdf",
    "stack_microservices_rust_v1.pdf",
)

writer = PdfWriter()
for filename in FILES:
    reader = PdfReader(GENERATED / filename)
    writer.append(reader)

with DESTINATION.open("wb") as output:
    writer.write(output)

print(f"{len(writer.pages)} pages: {DESTINATION}")
