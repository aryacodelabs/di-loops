namespace DiMapper.Sample.Services;

public interface IAppHost
{
}

public class AppHost : IAppHost
{
    public AppHost(IUserContext userContext)
    {
    }
}