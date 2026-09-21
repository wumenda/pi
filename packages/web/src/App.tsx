import { useEffect, useRef, useState } from "react";
import type { Client, ConnectionState } from "@earendil-works/pi-client";
import type { ServerHello } from "@earendil-works/pi-protocol";
import { isServerId } from "@earendil-works/pi-protocol";
import { createPiClient } from "./api/pi.ts";

type Catalogue = Awaited<ReturnType<Client["serviceCatalogue"]>>;

export function App() {
	const [url, setUrl] = useState("ws://127.0.0.1:8787");
	const [serverId, setServerId] = useState("");
	const [state, setState] = useState<ConnectionState>("disconnected");
	const [error, setError] = useState<string | undefined>(undefined);
	const [hello, setHello] = useState<ServerHello | undefined>(undefined);
	const [catalogue, setCatalogue] = useState<Catalogue | undefined>(undefined);
	const clientRef = useRef<Client | undefined>(undefined);

	useEffect(() => {
		return () => {
			const client = clientRef.current;
			clientRef.current = undefined;
			void client?.dispose();
		};
	}, []);

	const trimmedServerId = serverId.trim();
	const serverIdValid = isServerId(trimmedServerId);
	const busy = state === "connecting";
	const hasClient = clientRef.current !== undefined;

	const connect = (): void => {
		if (busy || !serverIdValid) return;
		setError(undefined);
		setHello(undefined);
		setCatalogue(undefined);
		const client = createPiClient({ url: url.trim(), serverId: trimmedServerId });
		clientRef.current = client;
		client.onConnectionStateChange((change) => {
			setState(change.state);
			if (change.state === "disconnected") {
				setHello(undefined);
				setCatalogue(undefined);
				if (change.error) setError(change.error.message);
			}
		});
		setState("connecting");
		void (async () => {
			try {
				const greeted = await client.connect();
				setHello(greeted);
				const entries = await client.serviceCatalogue({ serverId: trimmedServerId });
				setCatalogue(entries);
			} catch (connectError) {
				setError(connectError instanceof Error ? connectError.message : String(connectError));
			}
		})();
	};

	const disconnect = (): void => {
		const client = clientRef.current;
		if (!client) return;
		clientRef.current = undefined;
		client.disconnect();
		void client.dispose();
	};

	return (
		<main className="app">
			<h1>Pi Web</h1>
			<p className="hint">Connect to a pi-server over WebSocket.</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					connect();
				}}
			>
				<label>
					Endpoint
					<input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
				</label>
				<label>
					Server ID
					<input
						value={serverId}
						onChange={(event) => setServerId(event.target.value)}
						placeholder="00000000-0000-4000-8000-000000000000"
						spellCheck={false}
					/>
				</label>
				<div className="actions">
					<button type="submit" disabled={busy || !serverIdValid}>
						Connect
					</button>
					<button type="button" onClick={disconnect} disabled={!hasClient}>
						Disconnect
					</button>
				</div>
			</form>
			{serverId.length > 0 && !serverIdValid && <p className="error">Server ID must be a canonical lowercase UUIDv4.</p>}
			{state !== "disconnected" && <p className="status">State: {state}</p>}
			{hello && (
				<p className="status">
					Protocol v{hello.version} · server {hello.serverId}
				</p>
			)}
			{catalogue && (
				<section>
					<h2>Services</h2>
					<ul>
						{catalogue.map((entry) => (
							<li key={entry.serviceId}>
								{entry.serviceId} ({entry.mode})
							</li>
						))}
					</ul>
				</section>
			)}
			{error && <p className="error">{error}</p>}
		</main>
	);
}
