import { useId, type ReactNode } from "react";
import { Drawer, IconButton, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";

/**
 * A row's full details, from the right edge (full width on a phone). It is a
 * modal dialog: focus moves in, Tab stays inside, Escape or the close button
 * closes it, and focus returns to the row that opened it.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  leading,
  children,
  actions,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      className={["detail-drawer", className].filter(Boolean).join(" ")}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": titleId,
        },
      }}
    >
      <header className="detail-drawer-head">
        {leading && <span className="detail-drawer-leading">{leading}</span>}
        <div>
          <Typography component="h2" id={titleId} className="detail-title">
            {title}
          </Typography>
          {subtitle && (
            <Typography color="text.secondary" className="detail-subtitle">
              {subtitle}
            </Typography>
          )}
          {badge && <div className="detail-badge">{badge}</div>}
        </div>
        <IconButton aria-label="Close details" onClick={onClose} edge="end">
          <Close />
        </IconButton>
      </header>
      <div className="detail-drawer-body">{children}</div>
      {actions && <footer className="detail-drawer-actions">{actions}</footer>}
    </Drawer>
  );
}

/** A titled group of label/value pairs inside the drawer. */
export function DetailSection({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: ReactNode; numeric?: boolean }[];
}) {
  return (
    <section className="detail-section">
      <Typography component="h3" className="detail-section-title">
        {title}
      </Typography>
      <dl className="detail-list">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className={item.numeric ? "numeric" : undefined}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
