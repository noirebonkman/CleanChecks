// Every assertion is awaited before stopping Node's browser emulation handles.
try {
 await import('./run.mjs');
 await import('./clear-focus.mjs');
 process.exit(0);
} catch (error) {
 console.error(error);
 process.exit(1);
}
