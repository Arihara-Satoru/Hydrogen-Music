function animationDiagnosticsAllowed(app, env = process.env) {
  return app.isPackaged === false && env.HYDROGEN_ANIMATION_DIAGNOSTICS === '1';
}
module.exports = { animationDiagnosticsAllowed };
