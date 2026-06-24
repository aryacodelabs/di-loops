namespace DiMapper.Sample.Services;

public interface IOrderService
{
}

public interface IOrderRepository
{
}

public class OrderRepository : IOrderRepository
{
}

public interface IPaymentGateway
{
}

public interface IClock
{
}

public class OrderService : IOrderService
{
    public OrderService(IOrderRepository repository, IPaymentGateway paymentGateway, IClock clock)
    {
    }
}