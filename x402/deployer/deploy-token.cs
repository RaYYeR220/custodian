// Deploys the Cep18X402 token (Odra CEP-18 with transfer_with_authorization / CEP-3009)
// to Casper testnet, minting the full initial supply to USER_1 (our funded account).
// Adapted from .reference/casper-x402/infra/local/deployer/deployer.cs:
//   - deploy only (no transfers — USER_1 holds the whole supply and acts as the x402 client)
//   - chain_id taken from env CHAIN_ID (must be "casper:casper-test" for testnet)
// Run: dotnet run deploy-token.cs   (in mcr.microsoft.com/dotnet/sdk:10.0)
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:package Casper.Network.SDK@3.2.0
#:package DotNetEnv@3.0.0

using System.Diagnostics;
using Casper.Network.SDK;
using Casper.Network.SDK.Types;
using DotNetEnv;

class Program
{
    static async Task Main(string[] args)
    {
        var casperSdk = Values.GetCasperClient(false);

        var runtimeArgs = new List<NamedArg>
        {
            new NamedArg("name", "Casper X402 Token"),
            new NamedArg("symbol", "X402"),
            new NamedArg("decimals", CLValue.U8(9)),
            new NamedArg("initial_supply", CLValue.U256(1_000_000_000_000_000)),
            new NamedArg("chain_id", Values.GetEnvVar("CHAIN_ID")),
            new NamedArg("odra_cfg_is_upgradable", true),
            new NamedArg("odra_cfg_is_upgrade", false),
            new NamedArg("odra_cfg_allow_key_override", true),
            new NamedArg("odra_cfg_package_hash_key_name", "X402_package_hash"),
        };

        var wasm = File.ReadAllBytes("./Cep18X402.wasm");

        var transaction = new Transaction.SessionBuilder()
            .InstallOrUpgrade()
            .From(Values.User1KeyPair.PublicKey)
            .Wasm(wasm)
            .ChainName(Values.ChainName)
            .RuntimeArgs(runtimeArgs)
            .Payment(800_000_000_000)
            .Build();
        transaction.Sign(Values.User1KeyPair);

        Console.WriteLine("Deploy transaction hash: " + transaction.Hash);
        await casperSdk.PutTransaction(transaction);

        var tokenSource = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        await casperSdk.GetTransaction(transaction.Hash, false, tokenSource.Token);

        var response = await casperSdk.GetAccountInfo(Values.User1KeyPair.PublicKey);
        var accountInfo = response.Parse();

        var pkgKey = accountInfo.Account.NamedKeys.FirstOrDefault(k => k.Name == "X402_package_hash");
        if (pkgKey is null)
            throw new Exception("X402_package_hash not found under account named keys");

        var pkg = pkgKey.Key.ToString();
        Console.WriteLine("X402 token package hash: " + pkg);
        await File.WriteAllTextAsync(Values.GetEnvVar("X402_CONTRACT_ADDRESS_FILE"), pkg);
        Console.WriteLine("DEPLOY OK");
    }
}

public static class Values
{
    private static bool _loaded;
    public static void Load()
    {
        if (_loaded) return;
        Env.Load();
        _loaded = true;
    }

    public static string NodeAddress => GetEnvVar("NODE_ADDRESS");
    public static string ChainName => GetEnvVar("CHAIN_NAME");

    public static NetCasperClient GetCasperClient(bool logging = false)
    {
        var httpClient = new HttpClient();
        var authKey = Environment.GetEnvironmentVariable("CSPR_CLOUD_API_KEY");
        if (!string.IsNullOrEmpty(authKey))
            httpClient.DefaultRequestHeaders.Add("Authorization", authKey);
        return new NetCasperClient(NodeAddress, httpClient);
    }

    public static string GetEnvVar(string name)
    {
        Load();
        return Environment.GetEnvironmentVariable(name)
            ?? throw new NullReferenceException($"Environment variable {name} not found");
    }

    public static KeyPair User1KeyPair => KeyPair.FromPem(GetEnvVar("USER_1"));
}
