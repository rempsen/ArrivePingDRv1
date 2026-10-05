import { brand, footer } from "../config";
import { useAnchorNav } from "./SiteHeader";

export function SiteFooter() {
  const go = useAnchorNav();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <div className="footer__logo">
              <img src={brand.icon} alt="" width={36} height={36} className="header__mark" aria-hidden="true" />
              <img src={brand.logoDark} alt={brand.lockup} width={220} height={40} />
            </div>
            <p>{footer.description}</p>
          </div>
          {footer.columns.map((col) => (
            <div key={col.heading}>
              <h4>{col.heading}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} onClick={(e) => go(e, l.href)}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer__bottom">
          <span className="footer__bottom-brand">
            <img src={brand.icon} alt="" width={16} height={16} className="footer__mini-mark" aria-hidden="true" />
            {footer.legal}
          </span>
          <span>{brand.launch}</span>
        </div>
      </div>
    </footer>
  );
}
