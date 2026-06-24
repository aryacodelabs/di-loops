using DiMapper.Sample.Services;
using Microsoft.Extensions.DependencyInjection;

namespace DiMapper.Sample.Extensions;

public static class ServiceRegistrations
{
    public static void AddServiceRegistrations(this IServiceCollection services)
    {
        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        services.AddSingleton<IEmailSender, GraphEmailSender>();
    }
}