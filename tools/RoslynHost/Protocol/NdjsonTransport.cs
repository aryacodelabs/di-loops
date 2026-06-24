using System.Text.Json;

namespace DiLoops.RoslynHost.Protocol;

public sealed class NdjsonTransport(TextReader input, TextWriter output, JsonSerializerOptions options) : IAsyncDisposable
{
    public async Task<RoslynRequest?> ReadRequestAsync()
    {
        var line = await input.ReadLineAsync();
        if (line is null)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(line))
        {
            return await ReadRequestAsync();
        }

        var request = JsonSerializer.Deserialize<RoslynRequest>(line, options);
        if (request is null || request.ProtocolVersion != 1)
        {
            throw new InvalidOperationException("Invalid protocol version");
        }

        return request;
    }

    public async Task WriteResponseAsync(RoslynResponse response)
    {
        var json = JsonSerializer.Serialize(response, options);
        await output.WriteLineAsync(json);
        await output.FlushAsync();
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}