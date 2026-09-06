/**
 * Panel stylesheet, injected once by the tab component.
 *
 * Every colour is a `--dsw-alias-*` theme token with a literal fallback, so the
 * tab follows the user's light/dark choice like the shipped Settings pages and
 * still renders legibly if a token is ever renamed. Class names are prefixed
 * `dvi-` because this sheet is global — the plugin owns that prefix.
 */
export const css: string = `
.dvi{font:13px/1.55 var(--dsw-font-family,-apple-system,'Segoe UI','PingFang SC',sans-serif);color:var(--dsw-alias-label-primary,#1b1c1e);display:flex;flex-direction:column;gap:14px;padding:2px 0 18px}
.dvi *{box-sizing:border-box}
.dvi button{font:inherit;cursor:pointer;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:0.5px solid var(--dsw-alias-border-l3,#0000001f);border-radius:7px;padding:5px 11px}
.dvi button:hover{background:var(--dsw-alias-interactive-bg-hover,#00000008)}
.dvi button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
.dvi input,.dvi select{font:inherit;color:inherit;width:100%;padding:6px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);border:0.5px solid var(--dsw-alias-border-l4,#0000002b)}
.dvi select{width:auto;cursor:pointer}
.dvi input:focus-visible,.dvi select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent)}
.dvi .mono{font-family:var(--ds-font-family-code,'SF Mono',Consolas,monospace)}
.dvi .muted{color:var(--dsw-alias-label-tertiary,#00000073)}

.dvi-head{border:0.5px solid var(--dsw-alias-border-l3,#0000001f);border-radius:12px;padding:16px 18px;background:var(--dsw-alias-bg-layer-1,#fff);display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:space-between}
.dvi-head h2{margin:0 0 3px;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-version{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.dvi-version strong{font-size:27px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums}
.dvi-facts{margin:9px 0 0;display:grid;gap:3px 18px;grid-template-columns:auto minmax(0,1fr);font-size:12px}
.dvi-facts dt{color:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-facts dd{margin:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#000000a6)}
.dvi-headside{display:flex;flex-direction:column;align-items:flex-end;gap:7px;font-size:11px}

.dvi-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.dvi-metric{border:0.5px solid var(--dsw-alias-border-l3,#0000001f);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fff)}
.dvi-metric b{display:block;font-size:20px;font-weight:600;line-height:1.3;font-variant-numeric:tabular-nums}
.dvi-metric span{font-size:11px;color:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-metric.warn b{color:var(--dsw-alias-state-warn-primary,#d98324)}
.dvi-metric.bad b{color:var(--dsw-alias-state-error-primary,#e5484d)}

.dvi-note{border-radius:9px;padding:9px 12px;font-size:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d98324) 10%,transparent);color:var(--dsw-alias-state-warn-label,#8a5a12)}
.dvi-note.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d)}
.dvi-note code{font-family:var(--ds-font-family-code,'SF Mono',Consolas,monospace)}
.dvi-error{border-radius:9px;padding:12px;font-size:12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}

.dvi-toolbar{display:flex;gap:8px;align-items:center}
.dvi-toolbar>:first-child{flex:1;min-width:0}

.dvi-group{border:0.5px solid var(--dsw-alias-border-l3,#0000001f);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}
.dvi-group>summary{cursor:pointer;list-style:none;padding:11px 14px;display:flex;align-items:center;gap:9px;font-weight:500}
.dvi-group>summary::-webkit-details-marker{display:none}
.dvi-group>summary:hover{background:var(--dsw-alias-interactive-bg-hover,#00000008)}
.dvi-group>summary::before{content:'';width:0;height:0;border:4px solid transparent;border-left-color:currentColor;transition:transform var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out,ease);flex:none}
.dvi-group[open]>summary::before{transform:rotate(90deg) translateX(-1px)}
.dvi-group>summary .muted{font-weight:400;font-size:12px;margin-left:auto}

.dvi-row{border-top:0.5px solid var(--dsw-alias-border-l3,#0000001f)}
.dvi-row>summary{cursor:pointer;list-style:none;padding:9px 14px 9px 30px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.dvi-row>summary::-webkit-details-marker{display:none}
.dvi-row>summary:hover{background:var(--dsw-alias-interactive-bg-hover,#00000008)}
.dvi-name{overflow-wrap:anywhere;min-width:0}
.dvi-ver{margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px;padding:1px 8px;border-radius:5px;background:var(--dsw-alias-bg-layer-3,#0000000a);color:var(--dsw-alias-label-secondary,#000000a6);white-space:nowrap}
.dvi-ver.drift{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d98324) 14%,transparent);color:var(--dsw-alias-state-warn-label,#8a5a12)}
.dvi-ver.none{color:var(--dsw-alias-label-tertiary,#00000073)}

.dvi-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-dot.active{background:var(--dsw-alias-state-success-primary,#22c55e)}
.dvi-dot.failed{background:var(--dsw-alias-state-error-primary,#e5484d)}
.dvi-dot.pending,.dvi-dot.loading,.dvi-dot.unloading{background:var(--dsw-alias-state-business-primary,#4176e6)}
.dvi-dot.off{background:transparent;border:1px solid var(--dsw-alias-label-tertiary,#00000073)}

.dvi-tag{font-size:10px;line-height:1.6;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#0000000a);color:var(--dsw-alias-label-tertiary,#00000073);white-space:nowrap}
.dvi-tag.preset{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.dvi-tag.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 14%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d)}
.dvi-preset{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 14px}
.dvi-preset .dvi-ver{margin-left:auto}
.dvi-detail{padding:2px 14px 13px 30px;font-size:12px;display:grid;gap:3px 14px;grid-template-columns:auto minmax(0,1fr)}
.dvi-detail dt{color:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-detail dd{margin:0;overflow-wrap:anywhere}
.dvi-entries{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
.dvi-entries li{display:flex;flex-direction:column;gap:2px;padding-left:14px;border-left:2px solid var(--dsw-alias-border-l3,#0000001f)}
.dvi-entry-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-left:-16px}
.dvi-config{display:flex;gap:4px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#00000073)}
.dvi-config b{font-weight:500;color:var(--dsw-alias-label-secondary,#000000a6)}
.dvi-config b.redacted{color:var(--dsw-alias-state-warn-label,#8a5a12);letter-spacing:.1em}

.dvi-empty{padding:34px 14px;text-align:center;color:var(--dsw-alias-label-tertiary,#00000073)}
@media(max-width:640px){.dvi-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
