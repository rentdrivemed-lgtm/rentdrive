/* @ds-bundle: {"format":4,"namespace":"DrivePassDesignSystem_1a34f0","components":[{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Chip","sourcePath":"components/feedback/Chip.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"BottomNav","sourcePath":"components/navigation/BottomNav.jsx"},{"name":"Navbar","sourcePath":"components/navigation/Navbar.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"Breadcrumbs","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"Accordion","sourcePath":"components/surfaces/Accordion.jsx"},{"name":"Avatar","sourcePath":"components/surfaces/Avatar.jsx"},{"name":"AvatarGroup","sourcePath":"components/surfaces/Avatar.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardHeader","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardBody","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardFooter","sourcePath":"components/surfaces/Card.jsx"},{"name":"EmptyState","sourcePath":"components/surfaces/EmptyState.jsx"},{"name":"Modal","sourcePath":"components/surfaces/Modal.jsx"},{"name":"Drawer","sourcePath":"components/surfaces/Modal.jsx"},{"name":"StatCard","sourcePath":"components/surfaces/StatCard.jsx"},{"name":"Tabs","sourcePath":"components/surfaces/Tabs.jsx"},{"name":"VehiculoCard","sourcePath":"components/vehicle/VehiculoCard.jsx"}],"sourceHashes":{"components/feedback/Badge.jsx":"81bcb8890233","components/feedback/Chip.jsx":"b2ffcbca1d71","components/feedback/Skeleton.jsx":"81b0f65ed119","components/feedback/Spinner.jsx":"01092d20dad3","components/feedback/Toast.jsx":"362fbbd4420f","components/feedback/Tooltip.jsx":"bbedb2343aab","components/forms/Button.jsx":"e26c61002a88","components/forms/Checkbox.jsx":"bb97bc54dd1a","components/forms/IconButton.jsx":"2e7f4d211e8b","components/forms/Input.jsx":"bbf784722c72","components/forms/Radio.jsx":"2acf1e078678","components/forms/Select.jsx":"fa56563a11fd","components/forms/Switch.jsx":"953022249d38","components/forms/Textarea.jsx":"2f63a65f78f2","components/navigation/BottomNav.jsx":"82c44839c0c3","components/navigation/Navbar.jsx":"535d083a6bec","components/navigation/PageHeader.jsx":"6a36a588d249","components/surfaces/Accordion.jsx":"ccae5f63204f","components/surfaces/Avatar.jsx":"62b67134e690","components/surfaces/Card.jsx":"dd913f8a6396","components/surfaces/EmptyState.jsx":"43fd54742ab1","components/surfaces/Modal.jsx":"7374b0a55c8d","components/surfaces/StatCard.jsx":"eb43a4d97c2a","components/surfaces/Tabs.jsx":"da25b85cd719","components/vehicle/VehiculoCard.jsx":"1c0342d47e3b","ui_kits/app/Chat.jsx":"711a1e970d17","ui_kits/app/OwnerDashboard.jsx":"1b630b74761c","ui_kits/app/UserDashboard.jsx":"368791c9d2db","ui_kits/app/app.jsx":"a7829a1dd43b","ui_kits/app/data.js":"8d17845af45e","ui_kits/app/icons.js":"44566ec7e351","ui_kits/marketing/Catalog.jsx":"f48b887ba2d0","ui_kits/marketing/Hero.jsx":"c93abcb717b6","ui_kits/marketing/Sections.jsx":"713ec1f70007","ui_kits/marketing/VehicleDetail.jsx":"6f54bd31a6e3","ui_kits/marketing/app.jsx":"0d1ecaf4499d","ui_kits/marketing/data.js":"8d17845af45e","ui_kits/marketing/icons.js":"44566ec7e351"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DrivePassDesignSystem_1a34f0 = window.DrivePassDesignSystem_1a34f0 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Badge({
  children,
  variant = "neutral",
  dot = false,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["dp-badge", `dp-badge--${variant}`, className].filter(Boolean).join(" ")
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "dp-badge__dot"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Chip({
  children,
  selected = false,
  onRemove,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: ["dp-chip", selected ? "dp-chip--selected" : "", className].filter(Boolean).join(" "),
    "aria-pressed": selected
  }, rest), children, onRemove && /*#__PURE__*/React.createElement("span", {
    className: "dp-chip__x",
    role: "button",
    "aria-label": "Quitar",
    onClick: e => {
      e.stopPropagation();
      onRemove(e);
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Chip.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Skeleton({
  variant = "line",
  width,
  height,
  className = "",
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["shimmer", "dp-skeleton", `dp-skeleton--${variant}`, className].filter(Boolean).join(" "),
    style: {
      width,
      height,
      ...style
    },
    "aria-hidden": "true"
  }, rest));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Spinner({
  size = 20,
  className = "",
  ...rest
}) {
  const border = Math.max(2, Math.round(size / 9));
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["dp-spinner", className].filter(Boolean).join(" "),
    role: "status",
    "aria-label": "Cargando",
    style: {
      width: size,
      height: size,
      borderWidth: border
    }
  }, rest));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const ICONS = {
  success: /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }),
  info: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16v-4M12 8h.01"
  })),
  warning: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4M12 17h.01"
  })),
  danger: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m15 9-6 6M9 9l6 6"
  }))
};
function Toast({
  tone = "info",
  title,
  children,
  onClose,
  duration,
  className = "",
  ...rest
}) {
  React.useEffect(() => {
    if (!duration || !onClose) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-toast", className].filter(Boolean).join(" "),
    role: "status"
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: `dp-toast__icon dp-toast__icon--${tone}`
  }, /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, ICONS[tone])), /*#__PURE__*/React.createElement("div", {
    className: "dp-toast__body"
  }, title && /*#__PURE__*/React.createElement("div", {
    className: "dp-toast__title"
  }, title), children && /*#__PURE__*/React.createElement("div", {
    className: "dp-toast__msg"
  }, children)), onClose && /*#__PURE__*/React.createElement("button", {
    className: "dp-toast__close",
    onClick: onClose,
    "aria-label": "Cerrar"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tooltip({
  label,
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["dp-tooltip", className].filter(Boolean).join(" ")
  }, rest), children, /*#__PURE__*/React.createElement("span", {
    className: "dp-tooltip__bubble",
    role: "tooltip"
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  children,
  variant = "primary",
  size = "md",
  pill = false,
  block = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  type = "button",
  className = "",
  ...rest
}) {
  const cls = ["dp-btn", `dp-btn--${variant}`, `dp-btn--${size}`, pill ? "dp-btn--pill" : "", block ? "dp-btn--block" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls,
    disabled: disabled || loading,
    "aria-busy": loading
  }, rest), loading && /*#__PURE__*/React.createElement("span", {
    className: "dp-spin",
    "aria-hidden": "true"
  }), !loading && iconLeft, children && /*#__PURE__*/React.createElement("span", null, children), !loading && iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  id,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ["dp-check", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    id: id
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "dp-check__box"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  children,
  label,
  size = "md",
  ghost = false,
  className = "",
  ...rest
}) {
  const cls = ["dp-iconbtn", size === "sm" ? "dp-iconbtn--sm" : "", ghost ? "dp-iconbtn--ghost" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls,
    "aria-label": label,
    title: label
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  required = false,
  help,
  error,
  icon = null,
  id,
  className = "",
  ...rest
}) {
  const fieldId = id || (label ? `in-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: ["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "dp-field__label",
    htmlFor: fieldId
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__req"
  }, "*")), /*#__PURE__*/React.createElement("div", {
    className: "dp-field__wrap"
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__icon"
  }, icon), /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    className: ["dp-input", icon ? "dp-input--has-icon" : ""].filter(Boolean).join(" "),
    "aria-invalid": !!error
  }, rest))), error ? /*#__PURE__*/React.createElement("span", {
    className: "dp-field__error"
  }, error) : help && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__help"
  }, help));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  label,
  id,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ["dp-check", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "radio",
    id: id
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "dp-check__box dp-check__box--radio"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-check__dot"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  required = false,
  help,
  error,
  children,
  id,
  className = "",
  ...rest
}) {
  const fieldId = id || (label ? `sel-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: ["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "dp-field__label",
    htmlFor: fieldId
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__req"
  }, "*")), /*#__PURE__*/React.createElement("div", {
    className: "dp-select-wrap"
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fieldId,
    className: "dp-select",
    "aria-invalid": !!error
  }, rest), children), /*#__PURE__*/React.createElement("svg", {
    className: "dp-select-wrap__chev",
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))), error ? /*#__PURE__*/React.createElement("span", {
    className: "dp-field__error"
  }, error) : help && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__help"
  }, help));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  label,
  id,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ["dp-switch", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    id: id
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "dp-switch__track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  label,
  required = false,
  help,
  error,
  id,
  className = "",
  ...rest
}) {
  const fieldId = id || (label ? `ta-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: ["dp-field", error ? "dp-field--error" : "", className].filter(Boolean).join(" ")
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "dp-field__label",
    htmlFor: fieldId
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__req"
  }, "*")), /*#__PURE__*/React.createElement("textarea", _extends({
    id: fieldId,
    className: "dp-textarea",
    "aria-invalid": !!error
  }, rest)), error ? /*#__PURE__*/React.createElement("span", {
    className: "dp-field__error"
  }, error) : help && /*#__PURE__*/React.createElement("span", {
    className: "dp-field__help"
  }, help));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/BottomNav.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function BottomNav({
  items = [],
  value,
  onChange,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    className: ["dp-bottomnav", className].filter(Boolean).join(" ")
  }, rest), items.map(it => {
    const active = it.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      className: ["dp-bottomnav__item", active ? "dp-bottomnav__item--active" : ""].filter(Boolean).join(" "),
      "aria-current": active ? "page" : undefined,
      onClick: () => onChange && onChange(it.id)
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "relative",
        display: "flex"
      }
    }, it.icon, it.badge > 0 && /*#__PURE__*/React.createElement("span", {
      className: "dp-bottomnav__badge"
    }, it.badge > 9 ? "9+" : it.badge)), /*#__PURE__*/React.createElement("span", null, it.label));
  }));
}
Object.assign(__ds_scope, { BottomNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/BottomNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Navbar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const WORDMARK = /*#__PURE__*/React.createElement("svg", {
  width: "162",
  height: "45",
  viewBox: "0 0 210 58",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-label": "DrivePass rent a car"
}, /*#__PURE__*/React.createElement("g", {
  transform: "translate(2,2) scale(0.458)"
}, /*#__PURE__*/React.createElement("rect", {
  x: "4",
  y: "4",
  width: "88",
  height: "88",
  rx: "26",
  fill: "#1B3356"
}), /*#__PURE__*/React.createElement("rect", {
  x: "4.5",
  y: "4.5",
  width: "87",
  height: "87",
  rx: "25.5",
  fill: "none",
  stroke: "#FFFFFF",
  strokeOpacity: "0.14"
}), /*#__PURE__*/React.createElement("path", {
  d: "M26 38 H63",
  fill: "none",
  stroke: "#F25C2B",
  strokeWidth: "8",
  strokeLinecap: "round"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "55,29 66,38 55,47",
  fill: "none",
  stroke: "#F25C2B",
  strokeWidth: "8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/React.createElement("path", {
  d: "M70 58 H33",
  fill: "none",
  stroke: "#F4F6FA",
  strokeWidth: "8",
  strokeLinecap: "round"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "41,49 30,58 41,67",
  fill: "none",
  stroke: "#F4F6FA",
  strokeWidth: "8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
})), /*#__PURE__*/React.createElement("text", {
  x: "54",
  y: "30",
  fontFamily: "Geist, system-ui, sans-serif",
  fontSize: "23",
  fontWeight: "800",
  letterSpacing: "-0.5",
  fill: "#F4F6FA"
}, "Drive", /*#__PURE__*/React.createElement("tspan", {
  fill: "#F25C2B"
}, "Pass")), /*#__PURE__*/React.createElement("line", {
  x1: "55",
  y1: "41",
  x2: "203",
  y2: "41",
  stroke: "#FFFFFF",
  strokeOpacity: "0.16",
  strokeWidth: "1"
}), /*#__PURE__*/React.createElement("text", {
  x: "55",
  y: "52",
  fontFamily: "Geist, system-ui, sans-serif",
  fontSize: "10.5",
  fontWeight: "600",
  letterSpacing: "3.4",
  fill: "#A9B8CE"
}, "RENT A CAR"));
const Bell = () => /*#__PURE__*/React.createElement("svg", {
  width: "20",
  height: "20",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
}), /*#__PURE__*/React.createElement("path", {
  d: "M10.3 21a1.94 1.94 0 0 0 3.4 0"
}));
function Navbar({
  links = [],
  activeHref,
  solid = false,
  authed = false,
  user,
  notifications = 0,
  onNotifications,
  brand = WORDMARK,
  right,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("header", _extends({
    className: ["dp-navbar", solid ? "dp-navbar--solid" : "dp-navbar--transparent", className].filter(Boolean).join(" ")
  }, rest), /*#__PURE__*/React.createElement("a", {
    className: "dp-navbar__brand",
    href: "#"
  }, brand), links.length > 0 && /*#__PURE__*/React.createElement("nav", {
    className: "dp-navbar__nav"
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l.href,
    href: l.href,
    className: ["dp-navlink", l.href === activeHref ? "dp-navlink--active" : ""].filter(Boolean).join(" ")
  }, l.label))), /*#__PURE__*/React.createElement("div", {
    className: "dp-navbar__actions"
  }, right, authed && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "dp-iconbtn dp-iconbtn--ghost dp-navbar__bell",
    "aria-label": "Notificaciones",
    onClick: onNotifications
  }, /*#__PURE__*/React.createElement(Bell, null), notifications > 0 && /*#__PURE__*/React.createElement("span", {
    className: "dp-navbar__count"
  }, notifications > 9 ? "9+" : notifications)), user)));
}
Object.assign(__ds_scope, { Navbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Navbar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className
  }, rest), breadcrumbs && /*#__PURE__*/React.createElement("div", {
    className: "dp-crumbs"
  }, breadcrumbs), /*#__PURE__*/React.createElement("div", {
    className: "dp-pageheader"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "dp-pageheader__title"
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    className: "dp-pageheader__sub"
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    className: "dp-pageheader__actions"
  }, actions)));
}
function Breadcrumbs({
  items = [],
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    className: ["dp-crumbs", className].filter(Boolean).join(" "),
    "aria-label": "Breadcrumb"
  }, rest), items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, last ? /*#__PURE__*/React.createElement("span", {
      className: "dp-crumbs__current",
      "aria-current": "page"
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || "#"
    }, it.label), !last && /*#__PURE__*/React.createElement("span", {
      className: "dp-crumbs__sep"
    }, "/"));
  }));
}
Object.assign(__ds_scope, { PageHeader, Breadcrumbs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Accordion.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Accordion({
  items = [],
  defaultOpen = 0,
  allowMultiple = false,
  className = "",
  ...rest
}) {
  const [open, setOpen] = React.useState(() => Array.isArray(defaultOpen) ? defaultOpen : defaultOpen == null ? [] : [defaultOpen]);
  const toggle = i => {
    setOpen(prev => {
      const has = prev.includes(i);
      if (allowMultiple) return has ? prev.filter(x => x !== i) : [...prev, i];
      return has ? [] : [i];
    });
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-acc", className].filter(Boolean).join(" ")
  }, rest), items.map((it, i) => {
    const isOpen = open.includes(i);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: ["dp-acc__item", isOpen ? "dp-acc__item--open" : ""].filter(Boolean).join(" ")
    }, /*#__PURE__*/React.createElement("button", {
      className: "dp-acc__trigger",
      "aria-expanded": isOpen,
      onClick: () => toggle(i)
    }, /*#__PURE__*/React.createElement("span", null, it.q), /*#__PURE__*/React.createElement("span", {
      className: "dp-acc__chev"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "20",
      height: "20",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "m6 9 6 6 6-6"
    })))), isOpen && /*#__PURE__*/React.createElement("div", {
      className: "dp-acc__panel"
    }, it.a));
  }));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function Avatar({
  name = "",
  src,
  size = 40,
  verified = false,
  ring = false,
  className = "",
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["dp-avatar", className].filter(Boolean).join(" "),
    style: {
      width: size,
      height: size,
      fontSize: Math.round(size * 0.38),
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    className: "dp-avatar__img",
    src: src,
    alt: name
  }) : initials(name), ring && /*#__PURE__*/React.createElement("span", {
    className: "dp-avatar__ring"
  }), verified && /*#__PURE__*/React.createElement("span", {
    className: "dp-avatar__check",
    "aria-label": "Verificado"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "9",
    height: "9",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))));
}
function AvatarGroup({
  children,
  max = 4,
  size = 40,
  more,
  className = "",
  ...rest
}) {
  const items = React.Children.toArray(children);
  const shown = items.slice(0, max);
  const extra = more != null ? more : items.length - shown.length;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["dp-avatar-group", className].filter(Boolean).join(" ")
  }, rest), shown, extra > 0 && /*#__PURE__*/React.createElement("span", {
    className: "dp-avatar-group__more",
    style: {
      width: size,
      height: size,
      fontSize: Math.round(size * 0.34)
    }
  }, "+", extra));
}
Object.assign(__ds_scope, { Avatar, AvatarGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  interactive = false,
  as = "div",
  className = "",
  ...rest
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: ["dp-card", interactive ? "dp-card--interactive" : "", className].filter(Boolean).join(" ")
  }, rest), children);
}
function CardHeader({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-card__header", className].filter(Boolean).join(" ")
  }, rest), children);
}
function CardBody({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-card__body", className].filter(Boolean).join(" ")
  }, rest), children);
}
function CardFooter({
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-card__footer", className].filter(Boolean).join(" ")
  }, rest), children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardBody, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-empty", className].filter(Boolean).join(" ")
  }, rest), icon && /*#__PURE__*/React.createElement("div", {
    className: "dp-empty__icon"
  }, icon), title && /*#__PURE__*/React.createElement("div", {
    className: "dp-empty__title"
  }, title), description && /*#__PURE__*/React.createElement("div", {
    className: "dp-empty__desc"
  }, description), action && /*#__PURE__*/React.createElement("div", {
    className: "dp-empty__actions"
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Modal.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CloseBtn({
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    className: "dp-modal__close",
    onClick: onClick,
    "aria-label": "Cerrar"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })));
}
function Modal({
  open = true,
  onClose,
  title,
  children,
  footer,
  className = "",
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "dp-overlay",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-modal", className].filter(Boolean).join(" "),
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation()
  }, rest), (title || onClose) && /*#__PURE__*/React.createElement("div", {
    className: "dp-modal__head"
  }, title && /*#__PURE__*/React.createElement("h2", {
    className: "dp-modal__title"
  }, title), onClose && /*#__PURE__*/React.createElement(CloseBtn, {
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    className: "dp-modal__body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "dp-modal__body",
    style: {
      paddingTop: 0
    }
  }, footer)));
}
function Drawer({
  open = true,
  onClose,
  title,
  side = "responsive",
  children,
  className = "",
  ...rest
}) {
  if (!open) return null;
  const sideClass = side === "right" ? "dp-drawer--right" : side === "bottom" ? "dp-drawer--bottom" : "dp-drawer--responsive dp-drawer--right";
  return /*#__PURE__*/React.createElement("div", {
    className: "dp-overlay dp-drawer-overlay",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-drawer", sideClass, className].filter(Boolean).join(" "),
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation()
  }, rest), (title || onClose) && /*#__PURE__*/React.createElement("div", {
    className: "dp-modal__head"
  }, title && /*#__PURE__*/React.createElement("h2", {
    className: "dp-modal__title"
  }, title), onClose && /*#__PURE__*/React.createElement(CloseBtn, {
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    className: "dp-modal__body"
  }, children)));
}
Object.assign(__ds_scope, { Modal, Drawer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Modal.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function StatCard({
  label,
  value,
  icon,
  delta,
  spark,
  className = "",
  ...rest
}) {
  const dir = delta && delta.trim().startsWith("-") ? "down" : "up";
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-stat", className].filter(Boolean).join(" ")
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "dp-stat__head"
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "dp-stat__icon"
  }, icon), /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("div", {
    className: "dp-stat__value"
  }, value), delta && /*#__PURE__*/React.createElement("span", {
    className: `dp-stat__delta dp-stat__delta--${dir}`
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      transform: dir === "down" ? "rotate(180deg)" : "none"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 19V5M5 12l7-7 7 7"
  })), delta.replace(/^-/, "")), spark && /*#__PURE__*/React.createElement("div", {
    className: "dp-stat__spark"
  }, spark));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  tabs = [],
  value,
  onChange,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["dp-tabs", "scrollbar-none", className].filter(Boolean).join(" "),
    role: "tablist"
  }, rest), tabs.map(t => {
    const id = typeof t === "string" ? t : t.id;
    const label = typeof t === "string" ? t : t.label;
    const count = typeof t === "object" ? t.count : undefined;
    const active = id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      role: "tab",
      "aria-selected": active,
      className: ["dp-tab", active ? "dp-tab--active" : ""].filter(Boolean).join(" "),
      onClick: () => onChange && onChange(id)
    }, label, count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-muted)",
        marginLeft: 6
      }
    }, count), active && /*#__PURE__*/React.createElement("span", {
      className: "dp-tab__indicator"
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/vehicle/VehiculoCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Pin = () => /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "10",
  r: "3"
}));
const Heart = ({
  filled
}) => /*#__PURE__*/React.createElement("svg", {
  width: "18",
  height: "18",
  viewBox: "0 0 24 24",
  fill: filled ? "currentColor" : "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"
}));
function formatCOP(n) {
  return "$" + Math.round(n).toLocaleString("es-CO");
}
function VehiculoCard({
  vehiculo,
  favorite = false,
  onFavorite,
  onClick,
  className = "",
  ...rest
}) {
  const v = vehiculo || {};
  const inReview = !v.precioDia || v.precioDia === 0;
  return /*#__PURE__*/React.createElement("article", _extends({
    className: ["dp-vcard", className].filter(Boolean).join(" "),
    onClick: onClick
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "dp-vcard__media"
  }, v.foto ? /*#__PURE__*/React.createElement("img", {
    className: "dp-vcard__img",
    src: v.foto,
    alt: `${v.marca} ${v.modelo}`,
    loading: "lazy"
  }) : null, v.tipo && /*#__PURE__*/React.createElement("span", {
    className: "dp-vcard__type"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-badge dp-badge--neutral glass"
  }, v.tipo)), /*#__PURE__*/React.createElement("span", {
    className: "dp-vcard__state"
  }, inReview ? /*#__PURE__*/React.createElement("span", {
    className: "dp-badge dp-badge--warning"
  }, "En revisi\xF3n") : v.verificado !== false ? /*#__PURE__*/React.createElement("span", {
    className: "dp-badge dp-badge--success"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-badge__dot"
  }), "Verificado") : null), /*#__PURE__*/React.createElement("button", {
    className: ["dp-vcard__fav", favorite ? "dp-vcard__fav--on" : ""].filter(Boolean).join(" "),
    "aria-label": favorite ? "Quitar de guardados" : "Guardar",
    "aria-pressed": favorite,
    onClick: e => {
      e.stopPropagation();
      onFavorite && onFavorite(e);
    }
  }, /*#__PURE__*/React.createElement(Heart, {
    filled: favorite
  }))), /*#__PURE__*/React.createElement("div", {
    className: "dp-vcard__body"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "dp-vcard__title"
  }, v.marca, " ", v.modelo), /*#__PURE__*/React.createElement("div", {
    className: "dp-vcard__meta"
  }, /*#__PURE__*/React.createElement("span", null, v.anio), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Pin, null), v.ubicacion)), v.descripcion && /*#__PURE__*/React.createElement("p", {
    className: "dp-vcard__desc"
  }, v.descripcion), /*#__PURE__*/React.createElement("div", {
    className: "dp-vcard__foot"
  }, inReview ? /*#__PURE__*/React.createElement("span", {
    className: "dp-vcard__price dp-vcard__price--review"
  }, "Precio en revisi\xF3n") : /*#__PURE__*/React.createElement("span", {
    className: "dp-vcard__price"
  }, formatCOP(v.precioDia), " ", /*#__PURE__*/React.createElement("small", null, "/d\xEDa")), /*#__PURE__*/React.createElement("span", {
    className: "dp-btn dp-btn--secondary dp-btn--sm"
  }, "Ver m\xE1s"))));
}
Object.assign(__ds_scope, { VehiculoCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/vehicle/VehiculoCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Chat.jsx
try { (() => {
// DrivePass app — Chat (messenger between user and owner).
function Chat() {
  const {
    Avatar,
    Badge
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const convos = [{
    id: 1,
    n: "Andrés Mejía",
    car: "Mazda CX-5",
    last: "Perfecto, nos vemos el miércoles 👍",
    time: "10:42",
    unread: 0,
    ver: true
  }, {
    id: 2,
    n: "Laura Gómez",
    car: "Toyota Corolla",
    last: "¿El carro tiene silla para bebé?",
    time: "9:15",
    unread: 2,
    ver: true
  }, {
    id: 3,
    n: "Soporte DrivePass",
    car: "",
    last: "Tu documento fue aprobado.",
    time: "Ayer",
    unread: 0,
    ver: false
  }];
  const [active, setActive] = React.useState(1);
  const [draft, setDraft] = React.useState("");
  const [msgs, setMsgs] = React.useState([{
    me: false,
    t: "Hola Daniela, gracias por reservar el CX-5.",
    time: "10:30"
  }, {
    me: true,
    t: "¡Hola Andrés! ¿Dónde recojo el carro?",
    time: "10:35"
  }, {
    me: false,
    t: "En el Parque de El Poblado, a las 9am. Te paso la ubicación exacta.",
    time: "10:38"
  }, {
    me: true,
    t: "Listo, ahí estaré. Gracias!",
    time: "10:40"
  }, {
    me: false,
    t: "Perfecto, nos vemos el miércoles 👍",
    time: "10:42"
  }]);
  const a = convos.find(c => c.id === active);
  const endRef = React.useRef(null);
  React.useEffect(() => {
    if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight;
  }, [msgs, active]);
  const send = () => {
    if (!draft.trim()) return;
    setMsgs(m => [...m, {
      me: true,
      t: draft,
      time: "10:45"
    }]);
    setDraft("");
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "ch-wrap"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "ch-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ch-search"
  }, /*#__PURE__*/React.createElement(I.Search, {
    size: 16
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Buscar conversaci\xF3n"
  })), convos.map(c => /*#__PURE__*/React.createElement("button", {
    key: c.id,
    className: ["ch-conv", c.id === active ? "ch-conv--active" : ""].join(" "),
    onClick: () => setActive(c.id)
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: c.n,
    verified: c.ver,
    size: 44
  }), /*#__PURE__*/React.createElement("div", {
    className: "ch-conv__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ch-conv__top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ch-conv__name"
  }, c.n), /*#__PURE__*/React.createElement("span", {
    className: "ch-conv__time"
  }, c.time)), /*#__PURE__*/React.createElement("div", {
    className: "ch-conv__bottom"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ch-conv__last"
  }, c.last), c.unread > 0 && /*#__PURE__*/React.createElement("span", {
    className: "ch-unread"
  }, c.unread)), c.car && /*#__PURE__*/React.createElement("span", {
    className: "ch-conv__car"
  }, c.car))))), /*#__PURE__*/React.createElement("section", {
    className: "ch-thread"
  }, /*#__PURE__*/React.createElement("header", {
    className: "ch-thead"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: a.n,
    verified: a.ver,
    size: 40
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ch-conv__name"
  }, a.n), a.car && /*#__PURE__*/React.createElement("div", {
    className: "ap-muted",
    style: {
      fontSize: 13
    }
  }, "Sobre: ", a.car))), /*#__PURE__*/React.createElement("div", {
    className: "ch-msgs",
    ref: endRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "ch-daysep"
  }, /*#__PURE__*/React.createElement("span", null, "Hoy")), msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: ["ch-msg", m.me ? "ch-msg--me" : ""].join(" ")
  }, /*#__PURE__*/React.createElement("div", {
    className: "ch-bubble"
  }, m.t, /*#__PURE__*/React.createElement("span", {
    className: "ch-msg__time"
  }, m.time, m.me && /*#__PURE__*/React.createElement(I.Check, {
    size: 13
  })))))), /*#__PURE__*/React.createElement("div", {
    className: "ch-composer"
  }, /*#__PURE__*/React.createElement("button", {
    className: "dp-iconbtn dp-iconbtn--ghost",
    "aria-label": "Adjuntar"
  }, /*#__PURE__*/React.createElement(I.Camera, {
    size: 20
  })), /*#__PURE__*/React.createElement("input", {
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => e.key === "Enter" && send(),
    placeholder: "Escribe un mensaje\u2026"
  }), /*#__PURE__*/React.createElement("button", {
    className: "ch-send",
    "aria-label": "Enviar",
    onClick: send
  }, /*#__PURE__*/React.createElement(I.Send, {
    size: 18
  })))));
}
window.Chat = Chat;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Chat.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/OwnerDashboard.jsx
try { (() => {
// DrivePass app — Propietario dashboard.
function OwnerDashboard() {
  const {
    PageHeader,
    StatCard,
    Card,
    CardBody,
    Button,
    Badge,
    Avatar,
    EmptyState
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const cars = window.DP_CARS;
  const fleet = [cars[0], cars[3], cars[5]];
  const spark = /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    height: "36",
    viewBox: "0 0 120 36",
    preserveAspectRatio: "none"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "0,28 20,24 40,26 60,16 80,18 100,8 120,10",
    fill: "none",
    stroke: "var(--accent)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
  const solicitudes = [{
    n: "Daniela Ríos",
    rating: "4.9",
    car: "Mazda CX-5",
    fechas: "12 — 16 jun"
  }, {
    n: "Carlos Pérez",
    rating: "4.7",
    car: "Ford Ranger",
    fechas: "20 — 22 jun"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "ap-page"
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Hola, Andr\xE9s",
    subtitle: "Tu flota gener\xF3 ingresos esta semana.",
    actions: /*#__PURE__*/React.createElement(Button, {
      iconLeft: /*#__PURE__*/React.createElement(I.Plus, {
        size: 16
      })
    }, "Publicar nuevo carro")
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-stats ap-stats--4"
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Ingresos del mes",
    icon: /*#__PURE__*/React.createElement(I.Wallet, {
      size: 16
    }),
    value: "$3.480.000",
    delta: "+12%",
    spark: spark
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Reservas activas",
    icon: /*#__PURE__*/React.createElement(I.Calendar, {
      size: 16
    }),
    value: "5",
    delta: "+2"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Carros publicados",
    icon: /*#__PURE__*/React.createElement(I.Car, {
      size: 16
    }),
    value: "3"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Calificaci\xF3n",
    icon: /*#__PURE__*/React.createElement(I.Star, {
      size: 16
    }),
    value: "4.9"
  })), /*#__PURE__*/React.createElement("section", {
    className: "ap-block"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ap-h3"
  }, "Solicitudes de reserva"), /*#__PURE__*/React.createElement("div", {
    className: "ap-reqs"
  }, solicitudes.map((s, i) => /*#__PURE__*/React.createElement(Card, {
    key: i
  }, /*#__PURE__*/React.createElement(CardBody, null, /*#__PURE__*/React.createElement("div", {
    className: "ap-req"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: s.n,
    size: 42
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-req__info"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ap-req__name"
  }, s.n, " ", /*#__PURE__*/React.createElement("span", {
    className: "ap-muted",
    style: {
      fontWeight: 400
    }
  }, /*#__PURE__*/React.createElement(I.Star, {
    size: 13,
    fill: "currentColor"
  }), " ", s.rating)), /*#__PURE__*/React.createElement("div", {
    className: "ap-muted"
  }, s.car, " \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, s.fechas))), /*#__PURE__*/React.createElement("div", {
    className: "ap-req__actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Rechazar"), /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, "Aprobar")))))))), /*#__PURE__*/React.createElement("section", {
    className: "ap-block"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ap-h3"
  }, "Mis veh\xEDculos"), /*#__PURE__*/React.createElement("div", {
    className: "ap-fleet"
  }, fleet.map(c => {
    const review = !c.precioDia;
    return /*#__PURE__*/React.createElement(Card, {
      key: c.id,
      interactive: true
    }, /*#__PURE__*/React.createElement("div", {
      className: "ap-fleet__img",
      style: {
        backgroundImage: `url(${c.foto})`
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "ap-fleet__state"
    }, review ? /*#__PURE__*/React.createElement(Badge, {
      variant: "warning"
    }, "Docs en revisi\xF3n") : /*#__PURE__*/React.createElement(Badge, {
      variant: "success",
      dot: true
    }, "Publicado"))), /*#__PURE__*/React.createElement(CardBody, null, /*#__PURE__*/React.createElement("div", {
      className: "ap-fleet__row"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "ap-fleet__title"
    }, c.marca, " ", c.modelo), /*#__PURE__*/React.createElement("div", {
      className: "ap-muted"
    }, c.tipo, " \xB7 ", c.ubicacion)), /*#__PURE__*/React.createElement("div", {
      className: "ap-fleet__price t-mono"
    }, review ? "—" : window.formatCOP(c.precioDia), /*#__PURE__*/React.createElement("small", null, "/d\xEDa"))), /*#__PURE__*/React.createElement("div", {
      className: "ap-fleet__actions"
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm"
    }, "Editar"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconLeft: /*#__PURE__*/React.createElement(I.Calendar, {
        size: 15
      })
    }, "Calendario"))));
  }))));
}
window.OwnerDashboard = OwnerDashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/OwnerDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/UserDashboard.jsx
try { (() => {
// DrivePass app — Usuario dashboard.
function UserDashboard({
  favs,
  toggleFav
}) {
  const {
    PageHeader,
    StatCard,
    Card,
    CardBody,
    Button,
    Badge,
    Avatar,
    Tabs,
    VehiculoCard,
    EmptyState
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [tab, setTab] = React.useState("conf");
  const cars = window.DP_CARS;
  const next = cars[0];
  const reservas = [{
    car: cars[0],
    fechas: "12 — 16 jun",
    total: 920000,
    estado: "Confirmada",
    tone: "success",
    tab: "conf"
  }, {
    car: cars[1],
    fechas: "24 — 26 jun",
    total: 240000,
    estado: "Pendiente",
    tone: "info",
    tab: "pend"
  }, {
    car: cars[6],
    fechas: "2 — 5 may",
    total: 420000,
    estado: "Completada",
    tone: "neutral",
    tab: "comp"
  }];
  const shown = reservas.filter(r => tab === "all" || r.tab === tab);
  return /*#__PURE__*/React.createElement("div", {
    className: "ap-page"
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Hola, Daniela",
    subtitle: "Tienes 1 viaje pr\xF3ximo. \xA1Prep\xE1rate para conducir!",
    actions: /*#__PURE__*/React.createElement(Button, {
      iconLeft: /*#__PURE__*/React.createElement(I.Search, {
        size: 16
      })
    }, "Explorar carros")
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-stats"
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Reservas activas",
    icon: /*#__PURE__*/React.createElement(I.Calendar, {
      size: 16
    }),
    value: "2"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Pr\xF3ximo viaje",
    icon: /*#__PURE__*/React.createElement(I.Clock, {
      size: 16
    }),
    value: "6 d\xEDas",
    delta: "12 jun"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Carros guardados",
    icon: /*#__PURE__*/React.createElement(I.Heart, {
      size: 16
    }),
    value: String(favs.size)
  })), /*#__PURE__*/React.createElement("section", {
    className: "ap-block"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ap-h3"
  }, "Pr\xF3xima reserva"), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    className: "ap-next"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ap-next__img",
    style: {
      backgroundImage: `url(${next.foto})`
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-next__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ap-next__top"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ap-next__title"
  }, next.marca, " ", next.modelo, " \xB7 ", next.anio), /*#__PURE__*/React.createElement("div", {
    className: "ap-muted"
  }, /*#__PURE__*/React.createElement(I.Calendar, {
    size: 14
  }), " 12 \u2014 16 jun \xB7 ", /*#__PURE__*/React.createElement(I.Pin, {
    size: 14
  }), " ", next.ubicacion)), /*#__PURE__*/React.createElement(Badge, {
    variant: "success",
    dot: true
  }, "Confirmada")), /*#__PURE__*/React.createElement("div", {
    className: "ap-next__owner"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Andr\xE9s Mej\xEDa",
    verified: true,
    size: 36
  }), /*#__PURE__*/React.createElement("span", {
    className: "ap-muted"
  }, "Andr\xE9s Mej\xEDa \xB7 Propietario verificado")), /*#__PURE__*/React.createElement("div", {
    className: "ap-next__actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Ver detalle"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Chat, {
      size: 15
    })
  }, "Chat"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Cancelar")))))), /*#__PURE__*/React.createElement("section", {
    className: "ap-block"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ap-h3"
  }, "Mis reservas"), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      id: "conf",
      label: "Confirmadas"
    }, {
      id: "pend",
      label: "Pendientes"
    }, {
      id: "comp",
      label: "Completadas"
    }, {
      id: "all",
      label: "Todas"
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-table"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ap-table__head"
  }, /*#__PURE__*/React.createElement("span", null, "Veh\xEDculo"), /*#__PURE__*/React.createElement("span", null, "Fechas"), /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", null, "Estado")), shown.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(I.Calendar, {
      size: 28
    }),
    title: "Sin reservas en este estado",
    description: "Cuando reserves un carro aparecer\xE1 aqu\xED."
  }) : shown.map((r, i) => /*#__PURE__*/React.createElement("div", {
    className: "ap-row",
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    className: "ap-row__veh"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ap-row__thumb",
    style: {
      backgroundImage: `url(${r.car.foto})`
    }
  }), r.car.marca, " ", r.car.modelo), /*#__PURE__*/React.createElement("span", {
    className: "t-mono ap-muted"
  }, r.fechas), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, window.formatCOP(r.total)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Badge, {
    variant: r.tone,
    dot: r.tone !== "neutral"
  }, r.estado)))))), /*#__PURE__*/React.createElement("section", {
    className: "ap-block"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "ap-h3"
  }, "Guardados"), /*#__PURE__*/React.createElement("div", {
    className: "ap-grid"
  }, cars.filter(c => favs.has(c.id)).slice(0, 3).map(c => /*#__PURE__*/React.createElement(VehiculoCard, {
    key: c.id,
    vehiculo: c,
    favorite: true,
    onFavorite: () => toggleFav(c.id)
  })), favs.size === 0 && /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(I.Heart, {
      size: 28
    }),
    title: "Nada guardado a\xFAn",
    description: "Guarda tus carros favoritos para encontrarlos r\xE1pido.",
    action: /*#__PURE__*/React.createElement(Button, null, "Explorar carros")
  })))));
}
window.UserDashboard = UserDashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/UserDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/app.jsx
try { (() => {
// DrivePass app — authenticated shell (sidebar + bottom nav + role switch).
function AppShell() {
  const {
    BottomNav,
    Avatar,
    Button
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [role, setRole] = React.useState("usuario"); // usuario | propietario
  const [view, setView] = React.useState("inicio");
  const [favs, setFavs] = React.useState(() => new Set([1, 3, 6]));
  const toggleFav = id => setFavs(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  React.useEffect(() => {
    setView("inicio");
  }, [role]);
  const navUsuario = [{
    id: "inicio",
    label: "Inicio",
    icon: /*#__PURE__*/React.createElement(I.Grid, null)
  }, {
    id: "reservas",
    label: "Reservas",
    icon: /*#__PURE__*/React.createElement(I.Calendar, null)
  }, {
    id: "chat",
    label: "Chat",
    icon: /*#__PURE__*/React.createElement(I.Chat, null),
    badge: 2
  }, {
    id: "perfil",
    label: "Perfil",
    icon: /*#__PURE__*/React.createElement(I.User, null)
  }];
  const navProp = [{
    id: "inicio",
    label: "Mis carros",
    icon: /*#__PURE__*/React.createElement(I.Car, null)
  }, {
    id: "reservas",
    label: "Reservas",
    icon: /*#__PURE__*/React.createElement(I.Calendar, null)
  }, {
    id: "chat",
    label: "Chat",
    icon: /*#__PURE__*/React.createElement(I.Chat, null),
    badge: 2
  }, {
    id: "perfil",
    label: "Perfil",
    icon: /*#__PURE__*/React.createElement(I.User, null)
  }];
  const nav = role === "usuario" ? navUsuario : navProp;
  const renderView = () => {
    if (view === "chat") return /*#__PURE__*/React.createElement(Chat, null);
    if (role === "usuario") return /*#__PURE__*/React.createElement(UserDashboard, {
      favs: favs,
      toggleFav: toggleFav
    });
    return /*#__PURE__*/React.createElement(OwnerDashboard, null);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "ap-shell"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "ap-side"
  }, /*#__PURE__*/React.createElement("a", {
    className: "ap-side__brand",
    href: "#"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-wordmark.svg",
    width: "150",
    height: "41",
    alt: "DrivePass"
  })), /*#__PURE__*/React.createElement("div", {
    className: "ap-roleswitch"
  }, /*#__PURE__*/React.createElement("button", {
    className: role === "usuario" ? "on" : "",
    onClick: () => setRole("usuario")
  }, "Usuario"), /*#__PURE__*/React.createElement("button", {
    className: role === "propietario" ? "on" : "",
    onClick: () => setRole("propietario")
  }, "Propietario")), /*#__PURE__*/React.createElement("nav", {
    className: "ap-nav"
  }, nav.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    className: ["ap-navitem", view === it.id ? "ap-navitem--active" : ""].join(" "),
    onClick: () => setView(it.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "ap-navitem__ic"
  }, it.icon), /*#__PURE__*/React.createElement("span", null, it.label), it.badge > 0 && /*#__PURE__*/React.createElement("span", {
    className: "ap-navitem__badge"
  }, it.badge)))), /*#__PURE__*/React.createElement("div", {
    className: "ap-side__user"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: role === "usuario" ? "Daniela Ríos" : "Andrés Mejía",
    verified: true,
    size: 40
  }), /*#__PURE__*/React.createElement("div", {
    className: "ap-side__uinfo"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ap-side__uname"
  }, role === "usuario" ? "Daniela Ríos" : "Andrés Mejía"), /*#__PURE__*/React.createElement("div", {
    className: "ap-muted",
    style: {
      fontSize: 12
    }
  }, role === "usuario" ? "Conductora" : "Propietario")), /*#__PURE__*/React.createElement("button", {
    className: "dp-iconbtn dp-iconbtn--ghost dp-iconbtn--sm",
    "aria-label": "Salir"
  }, /*#__PURE__*/React.createElement(I.Logout, {
    size: 18
  })))), /*#__PURE__*/React.createElement("main", {
    className: "ap-main"
  }, renderView()), /*#__PURE__*/React.createElement("div", {
    className: "ap-bottomnav"
  }, /*#__PURE__*/React.createElement(BottomNav, {
    value: view,
    onChange: setView,
    items: nav
  })));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(AppShell, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/data.js
try { (() => {
// Shared sample data for the DrivePass UI kits — real car photos (Unsplash).
window.DP_CARS = [{
  id: 1,
  marca: "Mazda",
  modelo: "CX-5",
  anio: 2023,
  tipo: "SUV",
  ubicacion: "El Poblado",
  precioDia: 180000,
  descripcion: "SUV full equipo, automático. Ideal para viajes en familia por Antioquia.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "KXR 482",
  foto: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 2,
  marca: "Toyota",
  modelo: "Corolla",
  anio: 2022,
  tipo: "Sedán",
  ubicacion: "Laureles",
  precioDia: 120000,
  descripcion: "Económico, cómodo y muy confiable para moverte por la ciudad.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "HJD 119",
  foto: "https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 3,
  marca: "Porsche",
  modelo: "911 Carrera",
  anio: 2021,
  tipo: "Lujo",
  ubicacion: "El Poblado",
  precioDia: 690000,
  descripcion: "Deportivo premium para una ocasión especial. Reserva con anticipación.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 2,
  placa: "PRS 911",
  foto: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 4,
  marca: "Ford",
  modelo: "Ranger",
  anio: 2023,
  tipo: "Pickup",
  ubicacion: "Envigado",
  precioDia: 240000,
  descripcion: "Pickup 4x4 lista para carretera y carga. Doble cabina.",
  transmision: "Manual",
  combustible: "Diésel",
  pasajeros: 5,
  placa: "FRG 770",
  foto: "https://images.unsplash.com/photo-1605893477799-b99a3b8b8f0e?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 5,
  marca: "Tesla",
  modelo: "Model 3",
  anio: 2023,
  tipo: "Eléctrico",
  ubicacion: "Belén",
  precioDia: 0,
  descripcion: "100% eléctrico, autopiloto. Estamos verificando este vehículo.",
  transmision: "Automática",
  combustible: "Eléctrico",
  pasajeros: 5,
  placa: "TSL 303",
  foto: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=900&q=80&auto=format&fit=crop",
  verificado: false
}, {
  id: 6,
  marca: "Mercedes-Benz",
  modelo: "Clase C",
  anio: 2022,
  tipo: "Lujo",
  ubicacion: "El Poblado",
  precioDia: 420000,
  descripcion: "Sedán de lujo, interior en cuero. Elegancia para reuniones y eventos.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "MBC 220",
  foto: "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 7,
  marca: "Renault",
  modelo: "Duster",
  anio: 2021,
  tipo: "SUV",
  ubicacion: "Sabaneta",
  precioDia: 140000,
  descripcion: "SUV práctica y ahorradora, perfecta para escapadas de fin de semana.",
  transmision: "Manual",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "RND 540",
  foto: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 8,
  marca: "Chevrolet",
  modelo: "Onix",
  anio: 2022,
  tipo: "Sedán",
  ubicacion: "Itagüí",
  precioDia: 110000,
  descripcion: "Compacto, ágil y económico. Ideal para la ciudad y el día a día.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "CHV 088",
  foto: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=900&q=80&auto=format&fit=crop",
  verificado: true
}];
window.DP_TIPOS = ["Sedán", "SUV", "Pickup", "Lujo", "Eléctrico"];
window.formatCOP = function (n) {
  return "$" + Math.round(n).toLocaleString("es-CO");
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/icons.js
try { (() => {
// Shared inline line-icon set (Lucide-style, stroke 1.8). Exposed as window.Icons.
(function () {
  const s = (paths, extra = {}) => (props = {}) => {
    const {
      size = 22,
      ...rest
    } = props;
    return React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: extra.fill || "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...rest
    }, paths.map((d, i) => React.createElement("path", {
      key: i,
      d
    })));
  };
  const raw = children => (props = {}) => {
    const {
      size = 22,
      ...rest
    } = props;
    return React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      dangerouslySetInnerHTML: {
        __html: children
      },
      ...rest
    });
  };
  window.Icons = {
    Search: raw('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    Pin: raw('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
    Calendar: raw('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    Chat: raw('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    User: raw('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
    Car: raw('<path d="M19 17h2v-3.3a2 2 0 0 0-.4-1.2L18 9h-3l-1.5-3.5A2 2 0 0 0 11.7 4H7.3a2 2 0 0 0-1.8 1.1L3.4 9 1.4 12.5a2 2 0 0 0-.4 1.2V17h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
    Shield: raw('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'),
    Camera: raw('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>'),
    FileSign: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>'),
    Star: raw('<path d="m12 2 3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9Z"/>'),
    Heart: raw('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>'),
    Bell: raw('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    Arrow: raw('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    Check: raw('<path d="M20 6 9 17l-5-5"/>'),
    Gas: raw('<path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18"/><path d="M3 12h10"/><path d="M13 8h3l3 3v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.5L19 6"/>'),
    Gear: raw('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/>'),
    Users: raw('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M17 4.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6"/>'),
    Wallet: raw('<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 11v3h-4a2 2 0 0 1 0-4h4Z"/>'),
    Grid: raw('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    Plus: raw('<path d="M12 5v14M5 12h14"/>'),
    Filter: raw('<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>'),
    Doc: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>'),
    Send: raw('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
    Plug: raw('<path d="M12 22v-5M9 8V2M15 8V2M7 8h10v3a5 5 0 0 1-10 0Z"/>'),
    ChevL: raw('<path d="m15 18-6-6 6-6"/>'),
    Clock: raw('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    Logout: raw('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>')
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/icons.js", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Catalog.jsx
try { (() => {
// DrivePass marketing — catalog with filter sidebar + results grid.
function Catalog({
  cars,
  onOpen,
  favs,
  toggleFav,
  initialType
}) {
  const {
    VehiculoCard,
    Chip,
    Button,
    Select,
    EmptyState
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [types, setTypes] = React.useState(() => new Set(initialType ? [initialType] : []));
  const [maxPrice, setMaxPrice] = React.useState(700000);
  const [sort, setSort] = React.useState("rel");
  const toggleType = t => {
    const next = new Set(types);
    next.has(t) ? next.delete(t) : next.add(t);
    setTypes(next);
  };
  const clearAll = () => {
    setTypes(new Set());
    setMaxPrice(700000);
  };
  let results = cars.filter(c => (types.size === 0 || types.has(c.tipo)) && (c.precioDia === 0 || c.precioDia <= maxPrice));
  if (sort === "asc") results = [...results].sort((a, b) => a.precioDia - b.precioDia);
  if (sort === "desc") results = [...results].sort((a, b) => b.precioDia - a.precioDia);
  const activeChips = [...types];
  return /*#__PURE__*/React.createElement("div", {
    className: "ct-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ct-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "mk-h2",
    style: {
      marginBottom: 4
    }
  }, "Carros en Medell\xEDn"), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-mono",
    style: {
      color: "var(--text)"
    }
  }, results.length), " carros disponibles")), /*#__PURE__*/React.createElement(Select, {
    value: sort,
    onChange: e => setSort(e.target.value),
    "aria-label": "Ordenar"
  }, /*#__PURE__*/React.createElement("option", {
    value: "rel"
  }, "Relevancia"), /*#__PURE__*/React.createElement("option", {
    value: "asc"
  }, "Precio: menor a mayor"), /*#__PURE__*/React.createElement("option", {
    value: "desc"
  }, "Precio: mayor a menor"))), /*#__PURE__*/React.createElement("div", {
    className: "ct-body"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "ct-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ct-filter"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "mk-h4"
  }, "Tipo"), /*#__PURE__*/React.createElement("div", {
    className: "ct-chips"
  }, window.DP_TIPOS.map(t => /*#__PURE__*/React.createElement(Chip, {
    key: t,
    selected: types.has(t),
    onClick: () => toggleType(t)
  }, t)))), /*#__PURE__*/React.createElement("div", {
    className: "ct-filter"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "mk-h4"
  }, "Precio m\xE1ximo / d\xEDa"), /*#__PURE__*/React.createElement("input", {
    className: "ct-range",
    type: "range",
    min: "100000",
    max: "700000",
    step: "10000",
    value: maxPrice,
    onChange: e => setMaxPrice(+e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "ct-range__val t-mono"
  }, window.formatCOP(maxPrice))), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    block: true,
    onClick: clearAll
  }, "Limpiar todo")), /*#__PURE__*/React.createElement("div", {
    className: "ct-results"
  }, activeChips.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "ct-active"
  }, activeChips.map(t => /*#__PURE__*/React.createElement(Chip, {
    key: t,
    selected: true,
    onRemove: () => toggleType(t)
  }, t)), /*#__PURE__*/React.createElement("button", {
    className: "ct-clear",
    onClick: clearAll
  }, "Limpiar todo")), results.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(I.Car, {
      size: 30
    }),
    title: "No encontramos carros con esos filtros",
    description: "Prueba ampliando el precio o quitando filtros de tipo.",
    action: /*#__PURE__*/React.createElement(Button, {
      onClick: clearAll
    }, "Limpiar filtros")
  }) : /*#__PURE__*/React.createElement("div", {
    className: "mk-grid ct-grid"
  }, results.map((c, i) => /*#__PURE__*/React.createElement("div", {
    className: "fade-up",
    style: {
      "--i": i
    },
    key: c.id
  }, /*#__PURE__*/React.createElement(VehiculoCard, {
    vehiculo: c,
    favorite: favs.has(c.id),
    onFavorite: () => toggleFav(c.id),
    onClick: () => onOpen(c)
  })))))));
}
window.Catalog = Catalog;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Catalog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Hero.jsx
try { (() => {
// DrivePass marketing — Hero with floating glass search card.
function Hero({
  onSearch
}) {
  const {
    Button
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__glow"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__copy fade-up",
    style: {
      "--i": 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-overline",
    style: {
      color: "var(--accent)"
    }
  }, "Alquiler de carros entre particulares \xB7 Medell\xEDn"), /*#__PURE__*/React.createElement("h1", {
    className: "mk-hero__title"
  }, "Conduce libre", /*#__PURE__*/React.createElement("br", null), "por Medell\xEDn."), /*#__PURE__*/React.createElement("p", {
    className: "mk-hero__sub"
  }, "Reserva el carro que necesitas en minutos. Documentos verificados, contrato firmado y soporte en cada viaje."), /*#__PURE__*/React.createElement("div", {
    className: "mk-search glass"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-search__field"
  }, /*#__PURE__*/React.createElement("label", null, "Ubicaci\xF3n"), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__input"
  }, /*#__PURE__*/React.createElement(I.Pin, {
    size: 18
  }), /*#__PURE__*/React.createElement("input", {
    defaultValue: "Medell\xEDn, Antioquia"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__sep"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__field"
  }, /*#__PURE__*/React.createElement("label", null, "Inicio"), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__input"
  }, /*#__PURE__*/React.createElement(I.Calendar, {
    size: 18
  }), /*#__PURE__*/React.createElement("input", {
    defaultValue: "12 jun"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__sep"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__field"
  }, /*#__PURE__*/React.createElement("label", null, "Fin"), /*#__PURE__*/React.createElement("div", {
    className: "mk-search__input"
  }, /*#__PURE__*/React.createElement(I.Calendar, {
    size: 18
  }), /*#__PURE__*/React.createElement("input", {
    defaultValue: "16 jun"
  }))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: onSearch,
    iconLeft: /*#__PURE__*/React.createElement(I.Search, {
      size: 18
    })
  }, "Buscar carros")), /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__proof"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-dot"
  }), " +800 reservas completadas este mes"))));
}
window.Hero = Hero;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Sections.jsx
try { (() => {
// DrivePass marketing — content sections.
function Categories({
  onPick
}) {
  const I = window.Icons;
  const cats = [{
    t: "Sedán",
    icon: /*#__PURE__*/React.createElement(I.Car, null)
  }, {
    t: "SUV",
    icon: /*#__PURE__*/React.createElement(I.Car, null)
  }, {
    t: "Pickup",
    icon: /*#__PURE__*/React.createElement(I.Car, null)
  }, {
    t: "Lujo",
    icon: /*#__PURE__*/React.createElement(I.Star, null)
  }, {
    t: "Eléctrico",
    icon: /*#__PURE__*/React.createElement(I.Plug, null)
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-cats"
  }, cats.map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: c.t,
    className: "mk-cat fade-up",
    style: {
      "--i": i
    },
    onClick: () => onPick(c.t)
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-cat__ic"
  }, c.icon), /*#__PURE__*/React.createElement("span", null, c.t)))));
}
function Featured({
  cars,
  onOpen,
  favs,
  toggleFav
}) {
  const {
    VehiculoCard,
    Button
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-sechead"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "mk-h2"
  }, "Veh\xEDculos destacados"), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Los favoritos de la comunidad esta semana.")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => onOpen(),
    iconRight: /*#__PURE__*/React.createElement(I.Arrow, {
      size: 16
    })
  }, "Ver todo el cat\xE1logo")), /*#__PURE__*/React.createElement("div", {
    className: "mk-grid"
  }, cars.slice(0, 4).map((c, i) => /*#__PURE__*/React.createElement("div", {
    className: "fade-up",
    style: {
      "--i": i
    },
    key: c.id
  }, /*#__PURE__*/React.createElement(VehiculoCard, {
    vehiculo: c,
    favorite: favs.has(c.id),
    onFavorite: () => toggleFav(c.id),
    onClick: () => onOpen(c)
  })))));
}
function HowItWorks() {
  const I = window.Icons;
  const steps = [{
    n: "01",
    icon: /*#__PURE__*/React.createElement(I.Search, null),
    t: "Elige tu carro",
    d: "Filtra por tipo, precio y fechas. Compara y guarda tus favoritos."
  }, {
    n: "02",
    icon: /*#__PURE__*/React.createElement(I.FileSign, null),
    t: "Reserva en minutos",
    d: "Sube tus documentos una vez, firma el contrato y paga seguro."
  }, {
    n: "03",
    icon: /*#__PURE__*/React.createElement(I.Car, null),
    t: "Conduce libre",
    d: "Recoge el carro, registra las fotos y disfruta el viaje."
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "mk-h2 mk-center"
  }, "Reservar es as\xED de simple"), /*#__PURE__*/React.createElement("div", {
    className: "mk-steps"
  }, steps.map((s, i) => /*#__PURE__*/React.createElement("div", {
    className: "mk-step fade-up",
    style: {
      "--i": i
    },
    key: s.n
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-step__n t-mono"
  }, s.n), /*#__PURE__*/React.createElement("span", {
    className: "mk-step__ic"
  }, s.icon), /*#__PURE__*/React.createElement("h3", {
    className: "mk-h3"
  }, s.t), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, s.d)))));
}
function DualAudience() {
  const {
    Button
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-dual"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-dual__card"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-dual__ic"
  }, /*#__PURE__*/React.createElement(I.Car, null)), /*#__PURE__*/React.createElement("h3", {
    className: "mk-h3"
  }, "\xBFQuieres conducir?"), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Cientos de carros verificados te esperan. Reserva el tuyo hoy."), /*#__PURE__*/React.createElement(Button, null, "Crear cuenta")), /*#__PURE__*/React.createElement("div", {
    className: "mk-dual__card mk-dual__card--accent"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-dual__ic"
  }, /*#__PURE__*/React.createElement(I.Wallet, null)), /*#__PURE__*/React.createElement("h3", {
    className: "mk-h3"
  }, "\xBFTienes un carro? Monet\xEDzalo."), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Genera ingresos con tu veh\xEDculo cuando no lo usas. T\xFA pones las reglas."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Publicar mi carro"))));
}
function Trust() {
  const I = window.Icons;
  const items = [{
    icon: /*#__PURE__*/React.createElement(I.Shield, null),
    t: "Documentos verificados",
    d: "Validamos licencia e identidad de cada parte."
  }, {
    icon: /*#__PURE__*/React.createElement(I.Camera, null),
    t: "Fotos antes y después",
    d: "Registro del estado del carro en cada reserva."
  }, {
    icon: /*#__PURE__*/React.createElement(I.FileSign, null),
    t: "Contrato firmado",
    d: "Acuerdo digital firmado para tu tranquilidad."
  }, {
    icon: /*#__PURE__*/React.createElement(I.Clock, null),
    t: "Soporte 24/7",
    d: "Estamos contigo durante todo el viaje."
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec mk-trust"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-trust__grid"
  }, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    className: "mk-trust__item fade-up",
    style: {
      "--i": i
    },
    key: it.t
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-trust__ic"
  }, it.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "mk-h4"
  }, it.t), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, it.d))))));
}
function Testimonials() {
  const {
    Avatar
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const t = [{
    n: "Daniela R.",
    r: "Conductora",
    q: "Reservé en cinco minutos y el carro estaba impecable. La app es clarísima."
  }, {
    n: "Andrés M.",
    r: "Propietario",
    q: "Mi carro ya genera ingresos cada semana. El proceso de documentos es seguro."
  }, {
    n: "Valentina O.",
    r: "Conductora",
    q: "Me encantó poder ver las fotos antes y después. Todo transparente."
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "mk-h2 mk-center"
  }, "Lo que dice la comunidad"), /*#__PURE__*/React.createElement("div", {
    className: "mk-testi"
  }, t.map((x, i) => /*#__PURE__*/React.createElement("div", {
    className: "mk-testi__card fade-up",
    style: {
      "--i": i
    },
    key: x.n
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-stars"
  }, [0, 1, 2, 3, 4].map(s => /*#__PURE__*/React.createElement(I.Star, {
    key: s,
    size: 15,
    fill: "currentColor"
  }))), /*#__PURE__*/React.createElement("p", {
    className: "mk-testi__q"
  }, "\u201C", x.q, "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "mk-testi__who"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: x.n,
    size: 38
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mk-testi__name"
  }, x.n), /*#__PURE__*/React.createElement("div", {
    className: "mk-lead",
    style: {
      fontSize: 13
    }
  }, x.r)))))));
}
function FinalCTA({
  onSearch
}) {
  const {
    Button
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("section", {
    className: "mk-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-final gradient-hero"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "mk-final__title"
  }, "Tu pr\xF3ximo viaje empieza aqu\xED."), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Encuentra el carro perfecto en Medell\xEDn y conduce libre."), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: onSearch,
    iconRight: /*#__PURE__*/React.createElement(I.Arrow, {
      size: 18
    })
  }, "Buscar carros")));
}
function Footer() {
  const cols = [{
    h: "Producto",
    links: ["Explorar carros", "Cómo funciona", "Precios", "Ciudades"]
  }, {
    h: "Para propietarios",
    links: ["Publicar mi carro", "Calculadora de ingresos", "Garantías", "Centro de ayuda"]
  }, {
    h: "Para usuarios",
    links: ["Requisitos", "Reservas", "Seguros", "Preguntas frecuentes"]
  }, {
    h: "Legal",
    links: ["Términos", "Privacidad", "Cookies", "Contrato"]
  }];
  return /*#__PURE__*/React.createElement("footer", {
    className: "mk-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__brand"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-wordmark.svg",
    width: "160",
    height: "44",
    alt: "DrivePass"
  }), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead",
    style: {
      maxWidth: 260,
      marginTop: 12
    }
  }, "Conduce libre. Alquiler de carros entre particulares en Medell\xEDn.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__col",
    key: c.h
  }, /*#__PURE__*/React.createElement("h5", null, c.h), c.links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#"
  }, l))))), /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__bottom"
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 DrivePass Medell\xEDn"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, "Conduce libre.")));
}
Object.assign(window, {
  Categories,
  Featured,
  HowItWorks,
  DualAudience,
  Trust,
  Testimonials,
  FinalCTA,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Sections.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/VehicleDetail.jsx
try { (() => {
// DrivePass marketing — vehicle detail (conversion screen).
function VehicleDetail({
  car,
  onBack,
  fav,
  toggleFav
}) {
  const {
    Button,
    Badge,
    Avatar,
    Card,
    CardBody
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  if (!car) return null;
  const inReview = !car.precioDia;
  const days = 4;
  const deposit = 200000;
  const subtotal = car.precioDia * days;
  const total = subtotal + deposit;
  const specs = [{
    icon: /*#__PURE__*/React.createElement(I.Gear, {
      size: 18
    }),
    l: "Transmisión",
    v: car.transmision
  }, {
    icon: /*#__PURE__*/React.createElement(I.Gas, {
      size: 18
    }),
    l: "Combustible",
    v: car.combustible
  }, {
    icon: /*#__PURE__*/React.createElement(I.Users, {
      size: 18
    }),
    l: "Pasajeros",
    v: car.pasajeros
  }, {
    icon: /*#__PURE__*/React.createElement(I.Doc, {
      size: 18
    }),
    l: "Placa",
    v: car.placa,
    mono: true
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "vd-wrap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "vd-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(I.ChevL, {
    size: 18
  }), " Volver al cat\xE1logo"), /*#__PURE__*/React.createElement("div", {
    className: "vd-gallery"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-gallery__main"
  }, /*#__PURE__*/React.createElement("img", {
    src: car.foto,
    alt: `${car.marca} ${car.modelo}`
  }), /*#__PURE__*/React.createElement("div", {
    className: "vd-gallery__chips"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-badge dp-badge--neutral glass"
  }, car.tipo), car.verificado && /*#__PURE__*/React.createElement("span", {
    className: "dp-badge dp-badge--success"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dp-badge__dot"
  }), "Verificado"))), /*#__PURE__*/React.createElement("div", {
    className: "vd-gallery__thumbs"
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "vd-thumb",
    style: {
      backgroundImage: `url(${car.foto})`
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "vd-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "mk-h1"
  }, car.marca, " ", car.modelo, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      fontWeight: 400
    }
  }, "\xB7 ", car.anio)), /*#__PURE__*/React.createElement("div", {
    className: "vd-meta"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(I.Pin, {
    size: 16
  }), car.ubicacion), /*#__PURE__*/React.createElement("span", {
    className: "vd-meta__sep"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(I.Star, {
    size: 15,
    fill: "currentColor"
  }), "4.9 (38 rese\xF1as)"))), /*#__PURE__*/React.createElement("button", {
    className: ["dp-iconbtn", fav ? "" : ""].join(" "),
    "aria-label": "Guardar",
    onClick: toggleFav,
    style: {
      color: fav ? "var(--accent)" : "var(--text-soft)"
    }
  }, /*#__PURE__*/React.createElement(I.Heart, {
    size: 20,
    fill: fav ? "currentColor" : "none"
  }))), /*#__PURE__*/React.createElement("p", {
    className: "vd-desc"
  }, car.descripcion, " Mantenimiento al d\xEDa, llantas nuevas y kit de carretera incluido. Entrega en el punto que acordemos por el chat."), /*#__PURE__*/React.createElement("div", {
    className: "vd-specs"
  }, specs.map(s => /*#__PURE__*/React.createElement("div", {
    className: "vd-spec",
    key: s.l
  }, /*#__PURE__*/React.createElement("span", {
    className: "vd-spec__ic"
  }, s.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "vd-spec__l"
  }, s.l), /*#__PURE__*/React.createElement("div", {
    className: "vd-spec__v" + (s.mono ? " t-mono" : "")
  }, s.v))))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardBody, null, /*#__PURE__*/React.createElement("div", {
    className: "vd-owner"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Andr\xE9s Mej\xEDa",
    verified: true,
    size: 52
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-owner__name"
  }, "Andr\xE9s Mej\xEDa ", /*#__PURE__*/React.createElement(Badge, {
    variant: "success",
    dot: true
  }, "Propietario verificado")), /*#__PURE__*/React.createElement("div", {
    className: "mk-lead",
    style: {
      fontSize: 14
    }
  }, "Responde en ~15 min \xB7 4.9 \u2605 \xB7 64 viajes")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(I.Chat, {
      size: 16
    })
  }, "Mensaje")))), /*#__PURE__*/React.createElement("div", {
    className: "vd-trust"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-trust__item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vd-trust__ic"
  }, /*#__PURE__*/React.createElement(I.Shield, null)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "mk-h4"
  }, "Dep\xF3sito protegido"), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Se devuelve tras la entrega sin novedades."))), /*#__PURE__*/React.createElement("div", {
    className: "vd-trust__item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vd-trust__ic"
  }, /*#__PURE__*/React.createElement(I.Camera, null)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "mk-h4"
  }, "Fotos antes / despu\xE9s"), /*#__PURE__*/React.createElement("p", {
    className: "mk-lead"
  }, "Registro del estado del carro en cada reserva."))))), /*#__PURE__*/React.createElement("aside", {
    className: "vd-reserve"
  }, /*#__PURE__*/React.createElement(Card, {
    className: "vd-reserve__card glass"
  }, /*#__PURE__*/React.createElement(CardBody, null, inReview ? /*#__PURE__*/React.createElement("div", {
    className: "vd-price vd-price--review"
  }, "Precio en revisi\xF3n") : /*#__PURE__*/React.createElement("div", {
    className: "vd-price"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, window.formatCOP(car.precioDia)), " ", /*#__PURE__*/React.createElement("small", null, "/d\xEDa")), /*#__PURE__*/React.createElement("div", {
    className: "vd-dates"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-date"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vd-date__l"
  }, "Inicio"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, "12 jun")), /*#__PURE__*/React.createElement("div", {
    className: "vd-date"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vd-date__l"
  }, "Fin"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, "16 jun"))), !inReview && /*#__PURE__*/React.createElement("div", {
    className: "vd-breakdown"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vd-brow"
  }, /*#__PURE__*/React.createElement("span", null, window.formatCOP(car.precioDia), " \xD7 ", days, " d\xEDas"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, window.formatCOP(subtotal))), /*#__PURE__*/React.createElement("div", {
    className: "vd-brow"
  }, /*#__PURE__*/React.createElement("span", null, "Dep\xF3sito (reembolsable)"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, window.formatCOP(deposit))), /*#__PURE__*/React.createElement("div", {
    className: "vd-brow vd-brow--total"
  }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "t-mono vd-total"
  }, window.formatCOP(total)))), /*#__PURE__*/React.createElement(Button, {
    block: true,
    size: "lg",
    disabled: inReview
  }, inReview ? "No disponible aún" : "Reservar ahora"), /*#__PURE__*/React.createElement("p", {
    className: "vd-note"
  }, /*#__PURE__*/React.createElement(I.Check, {
    size: 14
  }), " Cancela gratis hasta 24h antes"))))), /*#__PURE__*/React.createElement("div", {
    className: "vd-bar glass"
  }, inReview ? /*#__PURE__*/React.createElement("span", {
    className: "vd-price vd-price--review",
    style: {
      margin: 0
    }
  }, "En revisi\xF3n") : /*#__PURE__*/React.createElement("span", {
    className: "vd-price",
    style: {
      margin: 0,
      fontSize: 20
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-mono"
  }, window.formatCOP(car.precioDia)), " ", /*#__PURE__*/React.createElement("small", null, "/d\xEDa")), /*#__PURE__*/React.createElement(Button, {
    disabled: inReview
  }, "Reservar")));
}
window.VehicleDetail = VehicleDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/VehicleDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/app.jsx
try { (() => {
// DrivePass marketing — app shell + router.
function MarketingApp() {
  const {
    Navbar,
    Button,
    Avatar
  } = window.DrivePassDesignSystem_1a34f0;
  const I = window.Icons;
  const [view, setView] = React.useState("home"); // home | catalog | detail
  const [car, setCar] = React.useState(null);
  const [initialType, setInitialType] = React.useState(null);
  const [favs, setFavs] = React.useState(() => new Set([3]));
  const [solid, setSolid] = React.useState(false);
  const scroller = React.useRef(null);
  const toggleFav = id => setFavs(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const openCatalog = type => {
    setInitialType(typeof type === "string" ? type : null);
    setView("catalog");
    scrollTop();
  };
  const openCar = c => {
    if (c && c.id) {
      setCar(c);
      setView("detail");
    } else {
      setView("catalog");
    }
    scrollTop();
  };
  const goHome = () => {
    setView("home");
    scrollTop();
  };
  const scrollTop = () => {
    if (scroller.current) scroller.current.scrollTop = 0;
  };
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setSolid(el.scrollTop > 24);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const navLinks = [{
    label: "Explorar",
    href: "#explorar"
  }, {
    label: "Para propietarios",
    href: "#prop"
  }, {
    label: "Cómo funciona",
    href: "#como"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "mk-app",
    ref: scroller
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      const a = e.target.closest("a.dp-navbar__brand");
      if (a) {
        e.preventDefault();
        goHome();
      }
    }
  }, /*#__PURE__*/React.createElement(Navbar, {
    solid: solid || view !== "home",
    links: navLinks,
    activeHref: view === "catalog" ? "#explorar" : undefined,
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm"
    }, "Iniciar sesi\xF3n"), /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Registrarse"))
  })), view === "home" && /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(window.Hero, {
    onSearch: () => openCatalog()
  }), /*#__PURE__*/React.createElement(Categories, {
    onPick: openCatalog
  }), /*#__PURE__*/React.createElement(Featured, {
    cars: window.DP_CARS,
    onOpen: openCar,
    favs: favs,
    toggleFav: toggleFav
  }), /*#__PURE__*/React.createElement(HowItWorks, null), /*#__PURE__*/React.createElement(DualAudience, null), /*#__PURE__*/React.createElement(Trust, null), /*#__PURE__*/React.createElement(Testimonials, null), /*#__PURE__*/React.createElement(FinalCTA, {
    onSearch: () => openCatalog()
  }), /*#__PURE__*/React.createElement(Footer, null)), view === "catalog" && /*#__PURE__*/React.createElement("main", {
    className: "mk-page"
  }, /*#__PURE__*/React.createElement(Catalog, {
    cars: window.DP_CARS,
    onOpen: openCar,
    favs: favs,
    toggleFav: toggleFav,
    initialType: initialType
  }), /*#__PURE__*/React.createElement(Footer, null)), view === "detail" && /*#__PURE__*/React.createElement("main", {
    className: "mk-page"
  }, /*#__PURE__*/React.createElement(VehicleDetail, {
    car: car,
    onBack: () => openCatalog(),
    fav: favs.has(car && car.id),
    toggleFav: () => car && toggleFav(car.id)
  }), /*#__PURE__*/React.createElement(Footer, null)));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(MarketingApp, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/data.js
try { (() => {
// Shared sample data for the DrivePass UI kits — real car photos (Unsplash).
window.DP_CARS = [{
  id: 1,
  marca: "Mazda",
  modelo: "CX-5",
  anio: 2023,
  tipo: "SUV",
  ubicacion: "El Poblado",
  precioDia: 180000,
  descripcion: "SUV full equipo, automático. Ideal para viajes en familia por Antioquia.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "KXR 482",
  foto: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 2,
  marca: "Toyota",
  modelo: "Corolla",
  anio: 2022,
  tipo: "Sedán",
  ubicacion: "Laureles",
  precioDia: 120000,
  descripcion: "Económico, cómodo y muy confiable para moverte por la ciudad.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "HJD 119",
  foto: "https://images.unsplash.com/photo-1623869675781-80aa31012a5a?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 3,
  marca: "Porsche",
  modelo: "911 Carrera",
  anio: 2021,
  tipo: "Lujo",
  ubicacion: "El Poblado",
  precioDia: 690000,
  descripcion: "Deportivo premium para una ocasión especial. Reserva con anticipación.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 2,
  placa: "PRS 911",
  foto: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 4,
  marca: "Ford",
  modelo: "Ranger",
  anio: 2023,
  tipo: "Pickup",
  ubicacion: "Envigado",
  precioDia: 240000,
  descripcion: "Pickup 4x4 lista para carretera y carga. Doble cabina.",
  transmision: "Manual",
  combustible: "Diésel",
  pasajeros: 5,
  placa: "FRG 770",
  foto: "https://images.unsplash.com/photo-1605893477799-b99a3b8b8f0e?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 5,
  marca: "Tesla",
  modelo: "Model 3",
  anio: 2023,
  tipo: "Eléctrico",
  ubicacion: "Belén",
  precioDia: 0,
  descripcion: "100% eléctrico, autopiloto. Estamos verificando este vehículo.",
  transmision: "Automática",
  combustible: "Eléctrico",
  pasajeros: 5,
  placa: "TSL 303",
  foto: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=900&q=80&auto=format&fit=crop",
  verificado: false
}, {
  id: 6,
  marca: "Mercedes-Benz",
  modelo: "Clase C",
  anio: 2022,
  tipo: "Lujo",
  ubicacion: "El Poblado",
  precioDia: 420000,
  descripcion: "Sedán de lujo, interior en cuero. Elegancia para reuniones y eventos.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "MBC 220",
  foto: "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 7,
  marca: "Renault",
  modelo: "Duster",
  anio: 2021,
  tipo: "SUV",
  ubicacion: "Sabaneta",
  precioDia: 140000,
  descripcion: "SUV práctica y ahorradora, perfecta para escapadas de fin de semana.",
  transmision: "Manual",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "RND 540",
  foto: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=900&q=80&auto=format&fit=crop",
  verificado: true
}, {
  id: 8,
  marca: "Chevrolet",
  modelo: "Onix",
  anio: 2022,
  tipo: "Sedán",
  ubicacion: "Itagüí",
  precioDia: 110000,
  descripcion: "Compacto, ágil y económico. Ideal para la ciudad y el día a día.",
  transmision: "Automática",
  combustible: "Gasolina",
  pasajeros: 5,
  placa: "CHV 088",
  foto: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=900&q=80&auto=format&fit=crop",
  verificado: true
}];
window.DP_TIPOS = ["Sedán", "SUV", "Pickup", "Lujo", "Eléctrico"];
window.formatCOP = function (n) {
  return "$" + Math.round(n).toLocaleString("es-CO");
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/data.js", error: String((e && e.message) || e) }); }

// ui_kits/marketing/icons.js
try { (() => {
// Shared inline line-icon set (Lucide-style, stroke 1.8). Exposed as window.Icons.
(function () {
  const s = (paths, extra = {}) => (props = {}) => {
    const {
      size = 22,
      ...rest
    } = props;
    return React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: extra.fill || "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...rest
    }, paths.map((d, i) => React.createElement("path", {
      key: i,
      d
    })));
  };
  const raw = children => (props = {}) => {
    const {
      size = 22,
      ...rest
    } = props;
    return React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      dangerouslySetInnerHTML: {
        __html: children
      },
      ...rest
    });
  };
  window.Icons = {
    Search: raw('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    Pin: raw('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
    Calendar: raw('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    Chat: raw('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    User: raw('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
    Car: raw('<path d="M19 17h2v-3.3a2 2 0 0 0-.4-1.2L18 9h-3l-1.5-3.5A2 2 0 0 0 11.7 4H7.3a2 2 0 0 0-1.8 1.1L3.4 9 1.4 12.5a2 2 0 0 0-.4 1.2V17h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
    Shield: raw('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'),
    Camera: raw('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>'),
    FileSign: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>'),
    Star: raw('<path d="m12 2 3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9Z"/>'),
    Heart: raw('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>'),
    Bell: raw('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    Arrow: raw('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    Check: raw('<path d="M20 6 9 17l-5-5"/>'),
    Gas: raw('<path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18"/><path d="M3 12h10"/><path d="M13 8h3l3 3v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.5L19 6"/>'),
    Gear: raw('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/>'),
    Users: raw('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M17 4.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6"/>'),
    Wallet: raw('<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 11v3h-4a2 2 0 0 1 0-4h4Z"/>'),
    Grid: raw('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    Plus: raw('<path d="M12 5v14M5 12h14"/>'),
    Filter: raw('<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>'),
    Doc: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>'),
    Send: raw('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
    Plug: raw('<path d="M12 22v-5M9 8V2M15 8V2M7 8h10v3a5 5 0 0 1-10 0Z"/>'),
    ChevL: raw('<path d="m15 18-6-6 6-6"/>'),
    Clock: raw('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    Logout: raw('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>')
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/icons.js", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.BottomNav = __ds_scope.BottomNav;

__ds_ns.Navbar = __ds_scope.Navbar;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.Breadcrumbs = __ds_scope.Breadcrumbs;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.AvatarGroup = __ds_scope.AvatarGroup;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardBody = __ds_scope.CardBody;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Drawer = __ds_scope.Drawer;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.VehiculoCard = __ds_scope.VehiculoCard;

})();
