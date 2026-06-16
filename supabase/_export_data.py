"""Lee rentdrive.db (SQLite) y genera seed.sql con INSERTs para Postgres."""
import sqlite3
import os
import sys

DB = os.path.join(os.path.dirname(__file__), "..", "rentdrive.db")
OUT = os.path.join(os.path.dirname(__file__), "seed.sql")

# Mapping: tabla -> columnas en el orden esperado por Postgres
TABLES = {
    "usuarios": [
        "id","nombre","correo","password","rol","documento_identidad","estado_cuenta",
        "celular","tipo_documento","fecha_nacimiento","direccion","ciudad",
        "numero_licencia","contacto_emergencia","created_at",
    ],
    "vehiculos": [
        "id","propietario_id","marca","modelo","anio","tipo","ubicacion","precio_dia",
        "descripcion","fotos","disponible","dias_disponibles","fotos_detalle","placa",
        "documentos","documentos_estado","documentos_nota","documentos_revisiones","created_at",
    ],
    "conversaciones": ["id","propietario_id","usuario_id","created_at"],
    "mensajes": ["id","conversacion_id","remitente_id","contenido","created_at"],
    "lecturas": ["usuario_id","conversacion_id","ultimo_leido_id"],
    "reservas": [
        "id","usuario_id","vehiculo_id","fecha_inicio","fecha_fin","total","pago_estado",
        "estado","fotos_antes","fotos_despues","documento_id_url","licencia_url","firma_contrato","created_at",
    ],
    "notificaciones": [
        "id","destinatario_id","tipo","titulo","mensaje","referencia_id","referencia_tipo","leida","created_at",
    ],
}

def pg_lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    # string: escape quotes
    s = str(v).replace("'", "''")
    return f"'{s}'"

def main():
    if not os.path.exists(DB):
        print(f"❌ No encontré {DB}")
        sys.exit(1)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    lines = [
        "-- Datos exportados desde rentdrive.db (SQLite)",
        "-- Ejecutar DESPUÉS de schema.sql en el SQL Editor de Supabase",
        "BEGIN;",
        "",
    ]

    for tabla, cols in TABLES.items():
        # Detect existing columns to handle older DBs
        try:
            cur.execute(f"PRAGMA table_info({tabla})")
            existing = {r["name"] for r in cur.fetchall()}
        except sqlite3.OperationalError:
            print(f"⚠️  tabla {tabla} no existe, saltando")
            continue

        cols_present = [c for c in cols if c in existing]
        if not cols_present:
            continue

        try:
            cur.execute(f"SELECT {','.join(cols_present)} FROM {tabla}")
            rows = cur.fetchall()
        except sqlite3.OperationalError as e:
            print(f"⚠️  {tabla}: {e}")
            continue

        if not rows:
            continue

        lines.append(f"-- {tabla}: {len(rows)} filas")
        for r in rows:
            vals = ",".join(pg_lit(r[c]) for c in cols_present)
            lines.append(
                f"INSERT INTO {tabla} ({','.join(cols_present)}) VALUES ({vals});"
            )
        lines.append("")

    # Reset sequences for tables with SERIAL ids
    lines.append("-- Sincronizar secuencias después de insertar IDs explícitos")
    for tabla in ["usuarios","vehiculos","conversaciones","mensajes","reservas","notificaciones"]:
        lines.append(
            f"SELECT setval(pg_get_serial_sequence('{tabla}','id'), "
            f"COALESCE((SELECT MAX(id) FROM {tabla}), 1));"
        )
    lines.append("")
    lines.append("COMMIT;")

    with open(OUT, "w") as f:
        f.write("\n".join(lines))

    print(f"✓ seed.sql generado en {OUT} ({sum(1 for l in lines if l.startswith('INSERT'))} INSERTs)")

if __name__ == "__main__":
    main()
