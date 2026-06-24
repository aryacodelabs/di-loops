namespace DiMapper.Sample.Services;

public class MultiCtorService
{
    public MultiCtorService()
    {
    }

    public MultiCtorService(IOrderRepository repository, IClock clock)
    {
    }
}