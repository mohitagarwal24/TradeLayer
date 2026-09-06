.PHONY: build deploy generate-abis get-address account chain compile flatten fork format lint test verify

DEPLOY_SCRIPT ?= script/Deploy.s.sol

# setup wallet for anvil
setup-anvil-wallet:
	rm -f ~/.foundry/keystores/scaffold-eth-default; rm -rf broadcast/Deploy.s.sol/31337
	cast wallet import --private-key 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 --unsafe-password 'localhost' scaffold-eth-default

# Start local chain
chain: setup-anvil-wallet
	anvil

# Start a fork
fork: setup-anvil-wallet
	anvil --fork-url ${FORK_URL} --chain-id 31337

# Deploy the contracts
deploy:
	@if [ ! -f "$(DEPLOY_SCRIPT)" ]; then 		echo "Error: Deploy script '$(DEPLOY_SCRIPT)' not found"; 		exit 1; 	fi
	@if [ "$(RPC_URL)" = "localhost" ]; then 		if [ "$(ETH_KEYSTORE_ACCOUNT)" = "scaffold-eth-default" ]; then 			forge script $(DEPLOY_SCRIPT) --rpc-url localhost --password localhost --broadcast --ffi; 		else 			forge script $(DEPLOY_SCRIPT) --rpc-url localhost --broadcast --ffi; 		fi 	else 		forge script $(DEPLOY_SCRIPT) --rpc-url $(RPC_URL) --broadcast --ffi; 	fi

# Deploy and generate ABIs
deploy-and-generate-abis: deploy generate-abis 

# Generate TypeScript ABIs
generate-abis:
	node scripts-js/generateTsAbis.js

# List account
account:
	@node scripts-js/checkAccountBalance.js

# Get address of a keystore
get-address:
	@cast wallet address --account $(ACCOUNT_NAME)

# Compile contracts
compile:
	forge compile

# Flatten contracts
flatten:
	forge flatten

# Format code
format:
	forge fmt && prettier --write ./scripts-js/**/*.js

# Lint code
lint:
	forge fmt --check && prettier --check ./scripts-js/**/*.js

# Run tests
test:
	forge test

# Verify contracts (Hedera testnet via Sourcify — pass ADDRESS=0x...)
verify:
	@if [ -z "$(ADDRESS)" ]; then \
		echo "Usage: make verify ADDRESS=0x... [RPC_URL=hederaTestnet]"; \
		exit 1; \
	fi
	forge verify-contract --chain-id 296 --verifier sourcify $(ADDRESS) TradeLayer

# Deploy to Hedera testnet (requires PRIVATE_KEY in packages/foundry/.env)
deploy-hedera-testnet:
	@if [ -z "$(PRIVATE_KEY)" ] && ! rg -q "^PRIVATE_KEY=0x" .env 2>/dev/null; then 		echo "Error: set PRIVATE_KEY in packages/foundry/.env first (yarn generate)"; 		exit 1; 	fi
	forge script script/Deploy.s.sol --rpc-url hederaTestnet --broadcast --ffi --slow
	node scripts-js/generateTsAbis.js

