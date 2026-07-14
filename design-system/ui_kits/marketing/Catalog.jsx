// DrivePass marketing — catalog with filter sidebar + results grid.
function Catalog({ cars, onOpen, favs, toggleFav, initialType }) {
  const { VehiculoCard, Chip, Button, Select, EmptyState } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [types, setTypes] = React.useState(() => new Set(initialType ? [initialType] : []));
  const [maxPrice, setMaxPrice] = React.useState(700000);
  const [sort, setSort] = React.useState("rel");

  const toggleType = (t) => {
    const next = new Set(types);
    next.has(t) ? next.delete(t) : next.add(t);
    setTypes(next);
  };
  const clearAll = () => { setTypes(new Set()); setMaxPrice(700000); };

  let results = cars.filter((c) => (types.size === 0 || types.has(c.tipo)) && (c.precioDia === 0 || c.precioDia <= maxPrice));
  if (sort === "asc") results = [...results].sort((a, b) => a.precioDia - b.precioDia);
  if (sort === "desc") results = [...results].sort((a, b) => b.precioDia - a.precioDia);

  const activeChips = [...types];

  return (
    <div className="ct-wrap">
      <div className="ct-head">
        <div>
          <h1 className="mk-h2" style={{marginBottom:4}}>Carros en Medellín</h1>
          <p className="mk-lead"><span className="t-mono" style={{color:"var(--text)"}}>{results.length}</span> carros disponibles</p>
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="rel">Relevancia</option>
          <option value="asc">Precio: menor a mayor</option>
          <option value="desc">Precio: mayor a menor</option>
        </Select>
      </div>

      <div className="ct-body">
        <aside className="ct-side">
          <div className="ct-filter">
            <h4 className="mk-h4">Tipo</h4>
            <div className="ct-chips">
              {window.DP_TIPOS.map((t) => <Chip key={t} selected={types.has(t)} onClick={() => toggleType(t)}>{t}</Chip>)}
            </div>
          </div>
          <div className="ct-filter">
            <h4 className="mk-h4">Precio máximo / día</h4>
            <input className="ct-range" type="range" min="100000" max="700000" step="10000" value={maxPrice} onChange={(e) => setMaxPrice(+e.target.value)} />
            <div className="ct-range__val t-mono">{window.formatCOP(maxPrice)}</div>
          </div>
          <Button variant="ghost" block onClick={clearAll}>Limpiar todo</Button>
        </aside>

        <div className="ct-results">
          {activeChips.length > 0 && (
            <div className="ct-active">
              {activeChips.map((t) => <Chip key={t} selected onRemove={() => toggleType(t)}>{t}</Chip>)}
              <button className="ct-clear" onClick={clearAll}>Limpiar todo</button>
            </div>
          )}
          {results.length === 0 ? (
            <EmptyState icon={<I.Car size={30}/>} title="No encontramos carros con esos filtros" description="Prueba ampliando el precio o quitando filtros de tipo." action={<Button onClick={clearAll}>Limpiar filtros</Button>} />
          ) : (
            <div className="mk-grid ct-grid">
              {results.map((c, i) => (
                <div className="fade-up" style={{ "--i": i }} key={c.id}>
                  <VehiculoCard vehiculo={c} favorite={favs.has(c.id)} onFavorite={() => toggleFav(c.id)} onClick={() => onOpen(c)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
window.Catalog = Catalog;
