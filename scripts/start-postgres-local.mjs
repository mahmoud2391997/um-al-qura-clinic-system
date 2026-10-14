process.loadEnvFile('.env.postgres.local');
process.env.CLINIC_DEMO='1';
process.env.CLINIC_DEMO_ONLY='0';
process.argv=[process.argv[0],'next',...process.argv.slice(2)];
await import('../node_modules/next/dist/bin/next');
